from __future__ import annotations

import math
from array import array
from collections.abc import Sequence
from dataclasses import dataclass

from app.clients.speaker_embedding_client import (
    SpeakerEmbeddingClientError,
    SpeakerEmbeddingClientProtocol,
    get_default_speaker_embedding_client,
)
from app.core.config import settings
from app.schemas.soap import SpeakerRole
from app.schemas.speaker import SpeakerEnrollmentResponse
from app.services.audio_vad_service import compute_pcm16_channel_rms


class SpeakerEnrollmentError(Exception):
    """事前話者登録時の検証・抽出エラー。"""

    def __init__(self, message: str, *, code: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class EnrollmentAudioQuality:
    """登録音声の品質チェック結果。"""

    duration_sec: float
    voiced_sec: float
    rms_level: float
    peak_level: float
    warnings: list[str]


@dataclass(frozen=True)
class SpeakerMatchThresholds:
    """薬剤師ベクトル・患者一時重心・2ch 音量比の判定閾値。"""

    pharmacist_high: float = 0.50
    pharmacist_low: float = 0.35
    patient_low: float = 0.35
    margin: float = 0.08
    min_embed_sec: float = 0.6
    rms_dominance_ratio: float = 1.8
    min_patient_init_sec: float = 1.2
    min_active_rms: float = 0.010

    @classmethod
    def from_settings(cls) -> SpeakerMatchThresholds:
        return cls(
            pharmacist_high=settings.speaker_pharmacist_high_threshold,
            pharmacist_low=settings.speaker_pharmacist_low_threshold,
            patient_low=settings.speaker_patient_low_threshold,
            margin=settings.speaker_margin_threshold,
            min_embed_sec=settings.speaker_min_embed_seconds,
            rms_dominance_ratio=settings.speaker_rms_dominance_ratio,
        )


@dataclass(frozen=True)
class SpeakerVerificationDecision:
    """単一発話区間に対する話者判定結果。"""

    speaker_role: SpeakerRole
    speaker_label: str
    pharmacist_similarity: float | None
    patient_similarity: float | None
    used_embedding: bool
    is_short_utterance: bool
    reason: str


SPEAKER_LABEL_BY_ROLE: dict[SpeakerRole, str] = {
    "pharmacist": "薬剤師",
    "patient": "患者",
    "unknown": "話者不明",
}


def normalize_embedding(values: Sequence[float]) -> list[float] | None:
    """埋め込みベクトルを検証して L2 正規化する（非有限値や零ベクトルは None）。"""
    if not values:
        return None
    cleaned: list[float] = []
    sq_sum = 0.0
    for val in values:
        fval = float(val)
        if not math.isfinite(fval):
            return None
        cleaned.append(fval)
        sq_sum += fval * fval
    norm = math.sqrt(sq_sum)
    if norm <= 1e-12 or not math.isfinite(norm):
        return None
    return [val / norm for val in cleaned]


def cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    """同じ次元の 2 ベクトル間のコサイン類似度を算出する。"""
    if not vec_a or len(vec_a) != len(vec_b):
        return 0.0
    dot = 0.0
    norm_a_sq = 0.0
    norm_b_sq = 0.0
    for a_val, b_val in zip(vec_a, vec_b, strict=True):
        dot += a_val * b_val
        norm_a_sq += a_val * a_val
        norm_b_sq += b_val * b_val
    denom = math.sqrt(norm_a_sq) * math.sqrt(norm_b_sq)
    if denom <= 1e-12:
        return 0.0
    return max(-1.0, min(1.0, dot / denom))


def merge_centroid(
    current: Sequence[float],
    new_vec: Sequence[float],
    *,
    alpha: float = 0.1,
) -> list[float]:
    """移動平均（EMA）で会話内の一時話者重心を更新し、L2 再正規化する。"""
    weight = max(0.01, min(0.5, alpha))
    blended = [
        (1.0 - weight) * old_val + weight * new_val
        for old_val, new_val in zip(current, new_vec, strict=True)
    ]
    normalized = normalize_embedding(blended)
    return normalized if normalized is not None else list(current)


def analyze_pcm16_quality(
    pcm16_bytes: bytes,
    *,
    sample_rate: int = 16000,
    voiced_rms_threshold: float = 0.010,
) -> EnrollmentAudioQuality:
    """モノラル 16bit PCM の長さ・有音秒数・RMS・クリッピング状態を計測する。"""
    usable_bytes = len(pcm16_bytes) - (len(pcm16_bytes) % 2)
    if usable_bytes <= 0 or sample_rate <= 0:
        return EnrollmentAudioQuality(
            duration_sec=0.0,
            voiced_sec=0.0,
            rms_level=0.0,
            peak_level=0.0,
            warnings=["音声データが空です。"],
        )

    samples = array("h")
    samples.frombytes(pcm16_bytes[:usable_bytes])
    total_frames = len(samples)
    duration_sec = total_frames / float(sample_rate)

    peak_int = 0
    for sample in samples:
        abs_val = -sample if sample < 0 else sample
        if abs_val > peak_int:
            peak_int = abs_val
    peak_level = min(1.0, peak_int / 32768.0)

    overall_rms, _ = compute_pcm16_channel_rms(pcm16_bytes[:usable_bytes], channels=1)

    # 100ms フレームごとに有音区間を集計し、無音ばかりの録音を弾く
    frame_samples = max(1, sample_rate // 10)
    frame_bytes = frame_samples * 2
    voiced_sec = 0.0
    for offset in range(0, usable_bytes, frame_bytes):
        chunk = pcm16_bytes[offset : min(usable_bytes, offset + frame_bytes)]
        chunk_frames = len(chunk) // 2
        if chunk_frames <= 0:
            continue
        rms, _ = compute_pcm16_channel_rms(chunk, channels=1)
        if rms >= voiced_rms_threshold:
            voiced_sec += chunk_frames / float(sample_rate)

    warnings: list[str] = []
    if overall_rms < 0.012:
        warnings.append("音量が小さめです。マイクに近づいてはっきりと話してください。")
    if peak_level >= 0.98:
        warnings.append(
            "音割れ（クリッピング）の可能性があります。マイク距離を少し離してください。"
        )

    return EnrollmentAudioQuality(
        duration_sec=round(duration_sec, 3),
        voiced_sec=round(voiced_sec, 3),
        rms_level=round(overall_rms, 4),
        peak_level=round(peak_level, 4),
        warnings=warnings,
    )


def enroll_pharmacist_pcm16(
    pcm16_bytes: bytes,
    *,
    sample_rate: int = 16000,
    client: SpeakerEmbeddingClientProtocol | None = None,
    min_voiced_seconds: float | None = None,
    max_bytes: int | None = None,
) -> SpeakerEnrollmentResponse:
    """事前登録用の薬剤師音声から話者ベクトルを抽出し、品質メタ情報付きで返す（保存は行わない）。"""
    resolved_max_bytes = (
        max_bytes if max_bytes is not None else settings.speaker_enrollment_max_bytes
    )
    resolved_min_voiced = (
        min_voiced_seconds
        if min_voiced_seconds is not None
        else settings.speaker_enrollment_min_voiced_seconds
    )

    if len(pcm16_bytes) > resolved_max_bytes:
        raise SpeakerEnrollmentError(
            "登録音声が長すぎます。15秒以内で録音してください。",
            code="ENROLLMENT_TOO_LARGE",
            status_code=413,
        )
    if len(pcm16_bytes) < 2 or len(pcm16_bytes) % 2 != 0:
        raise SpeakerEnrollmentError(
            "16bit PCM（モノラル・偶数バイト）の音声データが必要です。",
            code="ENROLLMENT_INVALID_PCM",
            status_code=400,
        )

    quality = analyze_pcm16_quality(pcm16_bytes, sample_rate=sample_rate)
    if quality.voiced_sec < resolved_min_voiced:
        raise SpeakerEnrollmentError(
            f"有効な発声時間が短すぎます（検出 {quality.voiced_sec:.1f} 秒 / "
            f"必要 {resolved_min_voiced:.1f} 秒以上）。静かな環境で 3〜5 秒話してください。",
            code="ENROLLMENT_INSUFFICIENT_SPEECH",
            status_code=422,
        )

    resolved_client = client
    if resolved_client is None:
        try:
            resolved_client = get_default_speaker_embedding_client(require_available=True)
        except SpeakerEmbeddingClientError as exc:
            raise SpeakerEnrollmentError(
                str(exc),
                code=exc.code,
                status_code=503,
            ) from exc

    if resolved_client is None:
        raise SpeakerEnrollmentError(
            "話者認識機能が無効化されているか利用できません。",
            code="SPEAKER_RECOGNITION_DISABLED",
            status_code=503,
        )

    try:
        embedding = resolved_client.extract_embedding_from_pcm16(
            pcm16_bytes,
            sample_rate=sample_rate,
            channels=1,
            channel_index=0,
        )
    except SpeakerEmbeddingClientError as exc:
        raise SpeakerEnrollmentError(str(exc), code=exc.code, status_code=500) from exc

    if not embedding:
        raise SpeakerEnrollmentError(
            "音声から話者特徴を抽出できませんでした。もう少し長く明瞭に話してください。",
            code="ENROLLMENT_EXTRACTION_FAILED",
            status_code=422,
        )

    return SpeakerEnrollmentResponse(
        model_id=resolved_client.model_id,
        embedding_dim=len(embedding),
        embedding=embedding,
        duration_sec=quality.duration_sec,
        voiced_sec=quality.voiced_sec,
        rms_level=quality.rms_level,
        peak_level=quality.peak_level,
        quality_warnings=quality.warnings,
    )


class ConversationSpeakerTracker:
    """1会話のメモリ内だけで薬剤師登録ベクトル照合と患者一時重心を管理する。"""

    def __init__(
        self,
        *,
        thresholds: SpeakerMatchThresholds | None = None,
        expected_model_id: str | None = None,
    ) -> None:
        self._thresholds = thresholds or SpeakerMatchThresholds.from_settings()
        self._expected_model_id = expected_model_id or settings.speaker_model_id
        self._pharmacist_embedding: list[float] | None = None
        self._pharmacist_model_id: str | None = None
        self._patient_centroid: list[float] | None = None
        self._patient_update_count = 0

    @property
    def has_pharmacist_profile(self) -> bool:
        return self._pharmacist_embedding is not None

    @property
    def has_patient_centroid(self) -> bool:
        return self._patient_centroid is not None

    @property
    def patient_update_count(self) -> int:
        return self._patient_update_count

    def set_pharmacist_profile(
        self,
        *,
        model_id: str,
        embedding: Sequence[float],
    ) -> tuple[bool, str | None]:
        """端末ローカル保存から受け取った薬剤師声紋を会話メモリへ反映する。"""
        if model_id.strip() != self._expected_model_id:
            return (
                False,
                f"声紋モデルの版が一致しないため再登録が必要です ({model_id})。",
            )
        normalized = normalize_embedding(embedding)
        if normalized is None or len(normalized) < 16:
            return (False, "薬剤師声紋ベクトルの形式が不正です。")
        self._pharmacist_embedding = normalized
        self._pharmacist_model_id = model_id
        return (True, None)

    def clear_ephemeral_patient_state(self) -> None:
        """会話終了・リセット時に一時保持した患者重心を破棄する。"""
        self._patient_centroid = None
        self._patient_update_count = 0

    def verify_segment(
        self,
        *,
        channel_index: int,
        duration_sec: float,
        channel_levels: tuple[float, float],
        segment_embedding: Sequence[float] | None,
        noise_floor: tuple[float, float] = (0.002, 0.002),
    ) -> SpeakerVerificationDecision:
        """声の類似度と 2ch 音量差を組み合わせて話者を判定する（不確かなときは unknown）。"""
        fallback_role: SpeakerRole = "patient" if channel_index == 1 else "pharmacist"
        self_rms = channel_levels[1 if channel_index == 1 else 0]
        other_rms = channel_levels[0 if channel_index == 1 else 1]
        self_floor = noise_floor[1 if channel_index == 1 else 0]
        min_signal = max(self._thresholds.min_active_rms, self_floor * 2.0)

        # 薬剤師声紋が未登録の環境では、従来どおりチャンネル基準にフォールバックする
        if self._pharmacist_embedding is None:
            return SpeakerVerificationDecision(
                speaker_role=fallback_role,
                speaker_label=SPEAKER_LABEL_BY_ROLE[fallback_role],
                pharmacist_similarity=None,
                patient_similarity=None,
                used_embedding=False,
                is_short_utterance=duration_sec < self._thresholds.min_embed_sec,
                reason="no_pharmacist_profile",
            )

        is_short = duration_sec < self._thresholds.min_embed_sec
        seg_vec = (
            normalize_embedding(segment_embedding)
            if (not is_short and segment_embedding is not None)
            else None
        )

        # 短い返答（「はい」「いいえ」等）や埋め込み未抽出時は音量優位で暫定割当し、拮抗時は unknown
        if seg_vec is None:
            if (
                self_rms >= min_signal
                and self_rms >= other_rms * self._thresholds.rms_dominance_ratio
            ):
                return SpeakerVerificationDecision(
                    speaker_role=fallback_role,
                    speaker_label=SPEAKER_LABEL_BY_ROLE[fallback_role],
                    pharmacist_similarity=None,
                    patient_similarity=None,
                    used_embedding=False,
                    is_short_utterance=is_short,
                    reason="short_channel_dominant",
                )
            return SpeakerVerificationDecision(
                speaker_role="unknown",
                speaker_label=SPEAKER_LABEL_BY_ROLE["unknown"],
                pharmacist_similarity=None,
                patient_similarity=None,
                used_embedding=False,
                is_short_utterance=is_short,
                reason="short_ambiguous",
            )

        if len(seg_vec) != len(self._pharmacist_embedding):
            return SpeakerVerificationDecision(
                speaker_role=fallback_role,
                speaker_label=SPEAKER_LABEL_BY_ROLE[fallback_role],
                pharmacist_similarity=None,
                patient_similarity=None,
                used_embedding=False,
                is_short_utterance=is_short,
                reason="embedding_dim_mismatch",
            )

        sim_p = cosine_similarity(seg_vec, self._pharmacist_embedding)
        sim_q = (
            cosine_similarity(seg_vec, self._patient_centroid)
            if self._patient_centroid is not None
            else None
        )

        # 1. 事前登録済み薬剤師と高信頼に一致する場合
        if sim_p >= self._thresholds.pharmacist_high and (
            sim_q is None or (sim_p - sim_q) >= self._thresholds.margin
        ):
            return SpeakerVerificationDecision(
                speaker_role="pharmacist",
                speaker_label=SPEAKER_LABEL_BY_ROLE["pharmacist"],
                pharmacist_similarity=sim_p,
                patient_similarity=sim_q,
                used_embedding=True,
                is_short_utterance=False,
                reason="matched_pharmacist",
            )

        # 2. 会話内で構築した患者一時重心と明確に一致する場合
        if (
            sim_q is not None
            and sim_q >= self._thresholds.patient_low
            and (sim_q - sim_p) >= self._thresholds.margin
        ):
            # 薬剤師と紛らわしくなく、ch1 優位の高品質区間でのみ安全に EMA 更新する
            if (
                channel_index == 1
                and sim_p < self._thresholds.pharmacist_low
                and duration_sec >= self._thresholds.min_patient_init_sec
                and self_rms >= min_signal
                and self_rms >= other_rms * self._thresholds.rms_dominance_ratio
            ):
                assert self._patient_centroid is not None
                self._patient_centroid = merge_centroid(self._patient_centroid, seg_vec, alpha=0.1)
                self._patient_update_count += 1
            return SpeakerVerificationDecision(
                speaker_role="patient",
                speaker_label=SPEAKER_LABEL_BY_ROLE["patient"],
                pharmacist_similarity=sim_p,
                patient_similarity=sim_q,
                used_embedding=True,
                is_short_utterance=False,
                reason="matched_patient_centroid",
            )

        # 3. 薬剤師に明確に不一致かつ患者マイク (ch1) 優位の音声を会話限定の患者重心として登録・判定
        if (
            channel_index == 1
            and sim_p < self._thresholds.pharmacist_low
            and self_rms >= min_signal
            and self_rms >= other_rms * self._thresholds.rms_dominance_ratio
        ):
            if duration_sec >= self._thresholds.min_patient_init_sec:
                if self._patient_centroid is None:
                    self._patient_centroid = list(seg_vec)
                else:
                    self._patient_centroid = merge_centroid(
                        self._patient_centroid, seg_vec, alpha=0.1
                    )
                self._patient_update_count += 1
            return SpeakerVerificationDecision(
                speaker_role="patient",
                speaker_label=SPEAKER_LABEL_BY_ROLE["patient"],
                pharmacist_similarity=sim_p,
                patient_similarity=sim_q,
                used_embedding=True,
                is_short_utterance=False,
                reason="patient_channel_verified",
            )

        # 4. 第三者・雑音・薬剤師側で一致しない声・拮抗ケースは決め打ちせず unknown とする
        return SpeakerVerificationDecision(
            speaker_role="unknown",
            speaker_label=SPEAKER_LABEL_BY_ROLE["unknown"],
            pharmacist_similarity=sim_p,
            patient_similarity=sim_q,
            used_embedding=True,
            is_short_utterance=False,
            reason="ambiguous_or_unregistered",
        )
