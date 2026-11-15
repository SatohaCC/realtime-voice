import wave
from pathlib import Path

import pytest

from app.clients.speaker_embedding_client import get_default_speaker_embedding_client
from app.services.speaker_audio_service import select_speaker_audio
from app.services.speaker_service import ConversationSpeakerTracker


def test_real_model_preserves_speaker_identity_with_contiguous_waveforms() -> None:
    """ローカル配置済みモデル・独立録音で、音声加工による取り違えの再発を確認する。"""
    root = Path(__file__).resolve().parents[2] / ".cache" / "speaker-poc" / "samples"
    names = ["leijun-sr-1.wav", "leijun-test-sr-1.wav", "fangjun-test-sr-1.wav"]
    client = get_default_speaker_embedding_client()
    if client is None or not all((root / name).is_file() for name in names):
        pytest.skip("実モデルと独立録音サンプルが未配置のため実音声回帰検証は実行しない")

    def embedding(name: str, *, seconds: int | None = None) -> list[float]:
        with wave.open(str(root / name), "rb") as audio:
            rate = audio.getframerate()
            channels = audio.getnchannels()
            pcm = audio.readframes(rate * seconds if seconds else audio.getnframes())
        selected = select_speaker_audio(pcm, sample_rate=rate, channels=channels)
        result = client.extract_embedding_from_pcm16(selected.pcm16_bytes, sample_rate=rate)
        assert result is not None
        return result

    tracker = ConversationSpeakerTracker(expected_model_id=client.model_id)
    assert tracker.set_pharmacist_profile(model_id=client.model_id, embedding=embedding(names[0]))[
        0
    ]
    for name, expected in [(names[1], "pharmacist"), (names[2], "patient")]:
        decision = tracker.verify_segment(
            channel_index=1,
            duration_sec=3,
            channel_levels=(0.01, 0.12),
            segment_embedding=embedding(name, seconds=3),
        )
        assert decision.speaker_role == expected
