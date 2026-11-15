import math
import struct
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.speaker import SpeakerEnrollmentResponse
from app.services.speaker_service import (
    ConversationSpeakerTracker,
    SpeakerEnrollmentError,
    SpeakerMatchThresholds,
    analyze_pcm16_quality,
    cosine_similarity,
    enroll_pharmacist_pcm16,
    normalize_embedding,
)


def _make_pcm16(amplitude: int, duration_sec: float, sample_rate: int = 16000) -> bytes:
    """テスト用の均一矩形波モノラル PCM16 バイト列を生成する。"""
    n_samples = int(duration_sec * sample_rate)
    clamped = max(-32767, min(32767, amplitude))
    pattern = [clamped if (i // 8) % 2 == 0 else -clamped for i in range(n_samples)]
    return struct.pack(f"<{n_samples}h", *pattern)


def _basis_vec(primary_idx: int, dim: int = 32, noise: float = 0.0) -> list[float]:
    vec = [noise] * dim
    vec[primary_idx] = 1.0
    normalized = normalize_embedding(vec)
    assert normalized is not None
    return normalized


class _FakeSpeakerClient:
    def __init__(self, *, model_id: str = "test-model-v1", embedding: list[float] | None = None):
        self._model_id = model_id
        self._embedding = embedding if embedding is not None else _basis_vec(0)

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def embedding_dim(self) -> int:
        return len(self._embedding)

    def extract_embedding_from_pcm16(
        self,
        pcm16_bytes: bytes,
        *,
        sample_rate: int = 16000,
        channels: int = 1,
        channel_index: int = 0,
    ) -> list[float] | None:
        if len(pcm16_bytes) < 2 * channels * sample_rate // 5:
            return None
        return list(self._embedding)


def test_analyze_pcm16_quality_detects_warnings() -> None:
    quiet_pcm = _make_pcm16(amplitude=200, duration_sec=3.0)
    quiet = analyze_pcm16_quality(quiet_pcm, sample_rate=16000)
    assert quiet.duration_sec == pytest.approx(3.0, abs=0.01)
    assert quiet.voiced_sec == 0.0
    assert any("音量が小さめ" in w for w in quiet.warnings)

    clipped_pcm = _make_pcm16(amplitude=32700, duration_sec=3.0)
    clipped = analyze_pcm16_quality(clipped_pcm, sample_rate=16000)
    assert clipped.voiced_sec >= 2.9
    assert any("音割れ" in w for w in clipped.warnings)


def test_enroll_pharmacist_pcm16_validates_duration_and_returns_embedding() -> None:
    short_pcm = _make_pcm16(amplitude=3000, duration_sec=1.0)
    with pytest.raises(SpeakerEnrollmentError) as short_exc:
        enroll_pharmacist_pcm16(
            short_pcm,
            sample_rate=16000,
            client=_FakeSpeakerClient(),
            min_voiced_seconds=2.5,
        )
    assert short_exc.value.status_code == 422

    too_long_pcm = _make_pcm16(amplitude=3000, duration_sec=4.0)
    with pytest.raises(SpeakerEnrollmentError) as size_exc:
        enroll_pharmacist_pcm16(
            too_long_pcm,
            sample_rate=16000,
            client=_FakeSpeakerClient(),
            max_bytes=16000 * 2 * 2,
        )
    assert size_exc.value.status_code == 413

    valid_pcm = _make_pcm16(amplitude=3500, duration_sec=3.5)
    res = enroll_pharmacist_pcm16(
        valid_pcm,
        sample_rate=16000,
        client=_FakeSpeakerClient(model_id="campp-test"),
        min_voiced_seconds=2.5,
    )
    assert res.model_id == "campp-test"
    assert res.embedding_dim == 32
    assert res.voiced_sec >= 3.0
    assert math.isclose(sum(x * x for x in res.embedding), 1.0, rel_tol=1e-4)


def test_conversation_speaker_tracker_verification_and_unknown_guard() -> None:
    thresholds = SpeakerMatchThresholds(
        pharmacist_high=0.50,
        pharmacist_low=0.35,
        patient_low=0.35,
        margin=0.08,
        min_embed_sec=0.6,
        rms_dominance_ratio=1.8,
        min_patient_init_sec=1.2,
        min_active_rms=0.010,
    )
    tracker = ConversationSpeakerTracker(thresholds=thresholds, expected_model_id="campp-v1")

    ok_bad, msg_bad = tracker.set_pharmacist_profile(
        model_id="other-model", embedding=_basis_vec(0)
    )
    assert ok_bad is False
    assert msg_bad is not None

    pharmacist_vec = _basis_vec(0)
    ok_good, msg_good = tracker.set_pharmacist_profile(
        model_id="campp-v1", embedding=pharmacist_vec
    )
    assert ok_good is True
    assert msg_good is None

    # 1. ch1 に回り込んだ薬剤師の声でも薬剤師ベクトルと高一致なら pharmacist と判定する
    d1 = tracker.verify_segment(
        channel_index=1,
        duration_sec=2.0,
        channel_levels=(0.06, 0.03),
        segment_embedding=pharmacist_vec,
    )
    assert d1.speaker_role == "pharmacist"

    # 2. ch1 優位かつ非薬剤師の中音量音声 (0.016) で会話内限定の患者重心を初期化する
    patient_vec = _basis_vec(1)
    d2 = tracker.verify_segment(
        channel_index=1,
        duration_sec=2.0,
        channel_levels=(0.005, 0.016),
        segment_embedding=patient_vec,
    )
    assert d2.speaker_role == "patient"
    assert tracker.has_patient_centroid is True
    assert tracker.patient_update_count == 1

    # 3. 薬剤師に一致しない第三者の声（ch0 側）を「患者」と誤断定せず unknown 保留にする
    third_party_vec = _basis_vec(2)
    d3 = tracker.verify_segment(
        channel_index=0,
        duration_sec=2.0,
        channel_levels=(0.05, 0.01),
        segment_embedding=third_party_vec,
    )
    assert d3.speaker_role == "unknown"

    # 4. 患者の一時重心に一致すれば ch0 側へ回り込んでも patient 判定できる
    d4 = tracker.verify_segment(
        channel_index=0,
        duration_sec=1.5,
        channel_levels=(0.02, 0.05),
        segment_embedding=patient_vec,
    )
    assert d4.speaker_role == "patient"
    assert d4.patient_similarity is not None
    assert d4.patient_similarity > 0.9

    # 5. 短発話（「はい」等）は音量差だけで話者を確定せず unknown で保持する
    d_short_clear = tracker.verify_segment(
        channel_index=1,
        duration_sec=0.3,
        channel_levels=(0.005, 0.03),
        segment_embedding=None,
    )
    assert d_short_clear.speaker_role == "unknown"
    assert d_short_clear.is_short_utterance is True

    d_short_tie = tracker.verify_segment(
        channel_index=1,
        duration_sec=0.3,
        channel_levels=(0.02, 0.022),
        segment_embedding=None,
    )
    assert d_short_tie.speaker_role == "unknown"
    assert d_short_tie.is_short_utterance is True

    # 会話終了時に患者の一時重心は破棄され、薬剤師ベクトルとは独立して消去できる
    tracker.clear_ephemeral_patient_state()
    assert tracker.has_patient_centroid is False
    assert tracker.has_pharmacist_profile is True


def test_speaker_enroll_endpoint_requires_auth_and_returns_vector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TestClient(app)
    pcm = _make_pcm16(amplitude=3000, duration_sec=3.0)

    unauth = client.post("/api/speakers/enroll", content=pcm)
    assert unauth.status_code == 401

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        user_id="pharmacist-1",
        role="authenticated",
        expires_at=9999999999,
    )
    try:
        received_boundaries: list[list[int] | None] = []

        def _fake_enroll(
            pcm16_bytes: bytes,
            *,
            sample_rate: int = 16000,
            sample_frames: list[int] | None = None,
        ) -> SpeakerEnrollmentResponse:
            received_boundaries.append(sample_frames)
            return SpeakerEnrollmentResponse(
                model_id="campp-v1",
                embedding_dim=32,
                embedding=_basis_vec(0),
                duration_sec=3.0,
                voiced_sec=2.9,
                rms_level=0.09,
                peak_level=0.1,
                quality_warnings=[],
            )

        monkeypatch.setattr("app.routers.speakers.enroll_pharmacist_pcm16", _fake_enroll)
        resp = client.post(
            "/api/speakers/enroll?sample_rate=16000",
            content=pcm,
            headers={"Authorization": "Bearer dummy"},
        )
        assert resp.status_code == 200
        body: dict[str, Any] = resp.json()
        assert body["model_id"] == "campp-v1"
        assert body["embedding_dim"] == 32
        assert len(body["embedding"]) == 32
        assert received_boundaries == [None]
        resp = client.post(
            "/api/speakers/enroll?sample_frames=48000&sample_frames=48000&sample_frames=48000",
            content=pcm * 3,
            headers={"Authorization": "Bearer dummy"},
        )
        assert resp.status_code == 200
        assert received_boundaries[-1] == [48000, 48000, 48000]
    finally:
        app.dependency_overrides.clear()


def test_cosine_similarity_and_missing_model_error(tmp_path: Path) -> None:
    from app.clients.speaker_embedding_client import (
        SherpaSpeakerEmbeddingClient,
        SpeakerEmbeddingClientError,
    )

    vec = _basis_vec(0)
    assert cosine_similarity(vec, vec) == pytest.approx(1.0)
    assert cosine_similarity(vec, _basis_vec(1)) == pytest.approx(0.0)

    missing_client = SherpaSpeakerEmbeddingClient(
        model_path=tmp_path / "missing.onnx",
        num_threads=1,
    )
    assert missing_client.is_available() is False
    with pytest.raises(SpeakerEmbeddingClientError) as exc:
        missing_client.extract_embedding_from_pcm16(
            _make_pcm16(amplitude=3000, duration_sec=1.0),
            sample_rate=16000,
        )
    assert exc.value.code == "SPEAKER_MODEL_NOT_FOUND"


@pytest.mark.parametrize("channel", [0, 1])
@pytest.mark.parametrize("embedding", [None, [1.0] + [0.0] * 15])
def test_registered_profile_never_guesses_role_when_embedding_is_unavailable(
    channel: int, embedding: list[float] | None
) -> None:
    tracker = ConversationSpeakerTracker(expected_model_id="test")
    assert tracker.set_pharmacist_profile(model_id="test", embedding=_basis_vec(0))[0]
    decision = tracker.verify_segment(
        channel_index=channel,
        duration_sec=3,
        channel_levels=(0.2, 0.01) if channel == 0 else (0.01, 0.2),
        segment_embedding=embedding,
    )
    assert decision.speaker_role == "unknown"
    assert not tracker.has_patient_centroid


def test_patient_centroid_rejects_unmatched_voices_and_remains_stable() -> None:
    tracker = ConversationSpeakerTracker(expected_model_id="test")
    assert tracker.set_pharmacist_profile(model_id="test", embedding=_basis_vec(0))[0]

    def verify(embedding: list[float]) -> Any:
        return tracker.verify_segment(
            channel_index=1,
            duration_sec=3,
            channel_levels=(0.01, 0.2),
            segment_embedding=embedding,
        )

    patient = verify(_basis_vec(1))
    assert patient.speaker_role == "patient"
    for _ in range(30):
        result = verify(_basis_vec(2))
        assert result.speaker_role == "unknown"
    assert tracker.patient_update_count == 1
    matched = verify(_basis_vec(1))
    assert matched.speaker_role == "patient"
    assert matched.patient_similarity == pytest.approx(1)


@pytest.mark.parametrize("silence_seconds", [1, 7])
def test_multiple_enrollment_samples_are_selected_and_averaged(silence_seconds: int) -> None:
    calls: list[int] = []

    class Client(_FakeSpeakerClient):
        def extract_embedding_from_pcm16(self, pcm16_bytes: bytes, **kwargs: Any) -> list[float]:
            calls.append(len(pcm16_bytes))
            return _basis_vec(0, noise=0.01 * len(calls))

    speech = _make_pcm16(3000, 3)
    silence = bytes(16000 * 2 * silence_seconds)
    take = silence + speech
    result = enroll_pharmacist_pcm16(take * 3, client=Client(), sample_frames=[len(take) // 2] * 3)
    assert calls == [len(take)] * 3
    assert result.voiced_sec == 9
    assert result.embedding == pytest.approx(
        normalize_embedding(
            [
                sum(v)
                for v in zip(*[_basis_vec(0, noise=n) for n in (0.01, 0.02, 0.03)], strict=True)
            ]
        )
    )


def test_enrollment_rejects_inconsistent_clipped_and_individually_short_samples() -> None:
    class Client(_FakeSpeakerClient):
        calls = 0

        def extract_embedding_from_pcm16(self, pcm16_bytes: bytes, **kwargs: Any) -> list[float]:
            self.calls += 1
            return _basis_vec(self.calls)

    take = _make_pcm16(3000, 3)
    with pytest.raises(SpeakerEnrollmentError) as error:
        enroll_pharmacist_pcm16(take * 3, client=Client(), sample_frames=[48000] * 3)
    assert error.value.code == "ENROLLMENT_INCONSISTENT"
    with pytest.raises(SpeakerEnrollmentError) as error:
        enroll_pharmacist_pcm16(_make_pcm16(32767, 3), client=Client())
    assert error.value.code == "ENROLLMENT_CLIPPED"
    with pytest.raises(SpeakerEnrollmentError) as error:
        enroll_pharmacist_pcm16(take, client=Client(), sample_frames=[16000, 32000])
    assert error.value.code == "ENROLLMENT_INSUFFICIENT_SPEECH"
