import math
import re
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass

from app.core.config import settings
from app.schemas.soap import SpeakerRole, TranscriptSegmentModel, TranscriptStatus
from app.services.audio_vad_service import compute_pcm16_channel_rms
from app.services.speaker_service import (
    SPEAKER_LABEL_BY_ROLE,
    ConversationSpeakerTracker,
    SpeakerMatchThresholds,
)

SPEAKER_ROLE_BY_CHANNEL: dict[int, tuple[SpeakerRole, str]] = {
    0: ("pharmacist", "薬剤師"),
    1: ("patient", "患者"),
}


@dataclass(frozen=True)
class _AudioChunk:
    start: float
    end: float
    levels: tuple[float, float]


@dataclass(frozen=True)
class _PcmChunk:
    start: float
    end: float
    pcm16_bytes: bytes
    levels: tuple[float, float]
    channels: int
    sample_rate: int


class BackendAudioPcmRingBuffer:
    """会話中の一時話者照合用に直近数十秒間の PCM16 音声をメモリ内だけに保持するリングバッファ。"""

    def __init__(self, *, max_history_seconds: float | None = None) -> None:
        self._max_history_seconds = (
            max_history_seconds
            if max_history_seconds is not None
            else settings.speaker_pcm_history_seconds
        )
        self._end_sec = 0.0
        self._chunks: deque[_PcmChunk] = deque()

    def clear(self) -> None:
        self._end_sec = 0.0
        self._chunks.clear()

    def append_pcm16(
        self,
        pcm16_bytes: bytes,
        *,
        channels: int,
        sample_rate: int,
        levels: tuple[float, float] | None = None,
    ) -> None:
        if channels not in {1, 2} or sample_rate <= 0:
            return
        frame_bytes = 2 * channels
        usable_bytes = len(pcm16_bytes) - (len(pcm16_bytes) % frame_bytes)
        if usable_bytes <= 0:
            return
        duration = usable_bytes / (frame_bytes * sample_rate)
        resolved_levels = (
            levels
            if levels is not None
            else compute_pcm16_channel_rms(pcm16_bytes[:usable_bytes], channels=channels)
        )
        start = self._end_sec
        self._end_sec += duration
        self._chunks.append(
            _PcmChunk(
                start=start,
                end=self._end_sec,
                pcm16_bytes=pcm16_bytes[:usable_bytes],
                levels=resolved_levels,
                channels=channels,
                sample_rate=sample_rate,
            )
        )
        cutoff = self._end_sec - self._max_history_seconds
        while self._chunks and self._chunks[0].end < cutoff:
            self._chunks.popleft()

    def slice_pcm16(self, start_sec: float, end_sec: float) -> tuple[bytes, int, int] | None:
        """指定された時刻範囲 [start_sec, end_sec] に対応する PCM16 バイト列を切り出す。"""
        if end_sec <= start_sec or not self._chunks:
            return None
        parts: list[bytes] = []
        channels = 0
        sample_rate = 0
        covered = 0.0
        for chunk in self._chunks:
            overlap_start = max(start_sec, chunk.start)
            overlap_end = min(end_sec, chunk.end)
            if overlap_end <= overlap_start:
                continue
            channels = chunk.channels
            sample_rate = chunk.sample_rate
            frame_bytes = 2 * channels
            total_frames = len(chunk.pcm16_bytes) // frame_bytes
            chunk_dur = chunk.end - chunk.start
            if chunk_dur <= 0 or total_frames <= 0:
                continue
            s_ratio = max(0.0, (overlap_start - chunk.start) / chunk_dur)
            e_ratio = min(1.0, (overlap_end - chunk.start) / chunk_dur)
            s_frame = max(0, min(total_frames, int(math.floor(s_ratio * total_frames))))
            e_frame = max(s_frame, min(total_frames, int(math.ceil(e_ratio * total_frames))))
            if e_frame > s_frame:
                parts.append(chunk.pcm16_bytes[s_frame * frame_bytes : e_frame * frame_bytes])
                covered += overlap_end - overlap_start
        if not parts or covered < end_sec - start_sec - 1e-6:
            return None
        return (b"".join(parts), channels, sample_rate)

    def estimate_noise_floor(self) -> tuple[float, float]:
        """直近チャンクの下位 25% RMS からチャンネル別の暗騒音フロアを推定する。"""
        if len(self._chunks) < 4:
            return (0.002, 0.002)
        ch0 = sorted(chunk.levels[0] for chunk in self._chunks)
        ch1 = sorted(chunk.levels[1] for chunk in self._chunks)
        q_idx = max(0, min(len(ch0) - 1, len(ch0) // 4))
        floor0 = max(0.001, min(0.015, ch0[q_idx]))
        floor1 = max(0.001, min(0.015, ch1[q_idx]))
        return (floor0, floor1)


class BackendAudioLevelHistory:
    """送信音声の時刻に対応するチャンネル別 RMS を保持する履歴バッファ。"""

    def __init__(self, *, max_history_seconds: float = 120.0) -> None:
        self._max_history_seconds = max_history_seconds
        self._end_sec = 0.0
        self._chunks: deque[_AudioChunk] = deque()

    def reset_timeline(self) -> None:
        self._end_sec = 0.0
        self._chunks.clear()

    def append_pcm16(self, pcm16_bytes: bytes, *, channels: int, sample_rate: int) -> None:
        if channels not in {1, 2} or sample_rate <= 0:
            return
        usable_bytes = len(pcm16_bytes) - (len(pcm16_bytes) % (2 * channels))
        if usable_bytes <= 0:
            return
        duration = usable_bytes / (2 * channels * sample_rate)
        levels = compute_pcm16_channel_rms(pcm16_bytes[:usable_bytes], channels=channels)
        self.append_levels(duration_sec=duration, levels=levels)

    def append_levels(self, *, duration_sec: float, levels: tuple[float, float]) -> None:
        if duration_sec <= 0:
            return
        start = self._end_sec
        self._end_sec += duration_sec
        self._chunks.append(_AudioChunk(start=start, end=self._end_sec, levels=levels))
        cutoff = self._end_sec - self._max_history_seconds
        while self._chunks and self._chunks[0].end < cutoff:
            self._chunks.popleft()

    def levels_for(self, start_sec: float, end_sec: float) -> tuple[float, float]:
        if end_sec <= start_sec:
            return (0.0, 0.0)
        coverage = 0.0
        energy_0 = 0.0
        energy_1 = 0.0
        for chunk in self._chunks:
            overlap = max(0.0, min(end_sec, chunk.end) - max(start_sec, chunk.start))
            if overlap <= 0.0:
                continue
            coverage += overlap
            energy_0 += (chunk.levels[0] ** 2) * overlap
            energy_1 += (chunk.levels[1] ** 2) * overlap
        # 履歴が欠けている区間は推測で発話を除外しない
        if coverage < end_sec - start_sec - 1e-6:
            return (0.0, 0.0)
        return (math.sqrt(energy_0 / coverage), math.sqrt(energy_1 / coverage))


@dataclass(frozen=True)
class DeepgramWordTiming:
    """Deepgram alternatives[].words の単語別時刻情報。"""

    text: str
    start_sec: float
    end_sec: float
    confidence: float = 0.0


@dataclass(frozen=True)
class DeepgramTranscriptInput:
    """Deepgram 受信メッセージから正規化へ渡す抽出済みデータ。"""

    channel_index: int
    text: str
    is_final: bool
    speech_final: bool
    start_sec: float
    end_sec: float
    confidence: float
    words: tuple[DeepgramWordTiming, ...] = ()


def join_deepgram_words(words: Sequence[DeepgramWordTiming]) -> str:
    """日本語・英字混在の単語列を自然な表記へ連結する。"""
    parts: list[str] = []
    for word in words:
        token = word.text.strip()
        if not token:
            continue
        if (
            parts
            and parts[-1][-1].isascii()
            and parts[-1][-1].isalnum()
            and token[0].isascii()
            and token[0].isalnum()
        ):
            parts.append(" ")
        parts.append(token)
    return "".join(parts)


_SENTENCE_END_CHARS = ("。", "！", "？", "!", "?")


def build_word_clause_candidates(
    words: Sequence[DeepgramWordTiming],
    *,
    min_chunk_sec: float,
    min_pause_sec: float = 0.35,
    max_chunks: int = 4,
) -> list[tuple[DeepgramWordTiming, ...]]:
    """単語列を句読点・無音ポーズで候補チャンクに分割する（分割不要なら空リスト）。"""
    if len(words) < 2 or max_chunks < 2:
        return []
    chunks: list[tuple[DeepgramWordTiming, ...]] = []
    start_idx = 0
    total_end = words[-1].end_sec
    for idx in range(len(words) - 1):
        if len(chunks) >= max_chunks - 1:
            break
        cur = words[idx]
        nxt = words[idx + 1]
        is_boundary = cur.text.rstrip().endswith(_SENTENCE_END_CHARS) or (
            nxt.start_sec - cur.end_sec >= min_pause_sec
        )
        if not is_boundary:
            continue
        chunk_dur = cur.end_sec - words[start_idx].start_sec
        rem_dur = total_end - nxt.start_sec
        if chunk_dur >= min_chunk_sec and rem_dur >= min_chunk_sec:
            chunks.append(tuple(words[start_idx : idx + 1]))
            start_idx = idx + 1

    if not chunks:
        return []
    chunks.append(tuple(words[start_idx:]))
    return chunks


@dataclass(frozen=True)
class TranscriptApplyOutcome:
    """発話正規化の適用結果（後続再評価や他チャンネル重複置換による訂正セグメント群を含む）。"""

    segment: TranscriptSegmentModel | None
    removed: bool = False
    is_new_final: bool = False
    suppressed_crosstalk: bool = False
    refined_segments: tuple[TranscriptSegmentModel, ...] = ()
    removed_segments: tuple[TranscriptSegmentModel, ...] = ()


_PUNCT_AND_SPACE_RE = re.compile(r"[\s。、．，！？!?,.\-ー〜]+")


def _strip_text_for_match(text: str) -> str:
    """比較用に空白と一般的な句読点を除いた文字列を返す。"""
    return _PUNCT_AND_SPACE_RE.sub("", text)


def _char_bigram_jaccard(text_a: str, text_b: str) -> float:
    """日本語文向けの空白除去 2-gram Jaccard 類似度を算出する。"""
    norm_a = re.sub(r"\s+", "", text_a)
    norm_b = re.sub(r"\s+", "", text_b)
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0
    if len(norm_a) == 1 or len(norm_b) == 1:
        return 1.0 if norm_a == norm_b else 0.0
    grams_a = {norm_a[i : i + 2] for i in range(len(norm_a) - 1)}
    grams_b = {norm_b[i : i + 2] for i in range(len(norm_b) - 1)}
    union = grams_a | grams_b
    return len(grams_a & grams_b) / len(union) if union else 0.0


def _char_bigram_overlap_coeff(norm_a: str, norm_b: str) -> float:
    """短文側を分母にした 2-gram 包含係数を算出する（長短差がある回り込み検出用）。"""
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0
    if len(norm_a) == 1 or len(norm_b) == 1:
        return 1.0 if norm_a == norm_b else 0.0
    grams_a = {norm_a[i : i + 2] for i in range(len(norm_a) - 1)}
    grams_b = {norm_b[i : i + 2] for i in range(len(norm_b) - 1)}
    denom = min(len(grams_a), len(grams_b))
    return len(grams_a & grams_b) / denom if denom > 0 else 0.0


def _preferred_channel_for_role(role: SpeakerRole) -> int | None:
    if role == "pharmacist":
        return 0
    if role == "patient":
        return 1
    return None


def _is_voiceprint_channel_duplicate(
    *,
    incoming_text: str,
    incoming_start_sec: float,
    incoming_end_sec: float,
    incoming_role: SpeakerRole,
    incoming_channel: int,
    existing: TranscriptSegmentModel,
    overlap_levels: tuple[float, float],
) -> bool:
    """声紋有効時の 2ch 間重複（同一話者の両マイク拾い・片側 unknown 混入）かを判定する。"""
    inter = max(
        0.0,
        min(existing.end_sec, incoming_end_sec) - max(existing.start_sec, incoming_start_sec),
    )
    if inter <= 0.0:
        return False

    # 別々の既知話者（薬剤師 vs 患者）と判定できている場合は同時発話として必ず保持する
    if (
        incoming_role in {"pharmacist", "patient"}
        and existing.speaker_role in {"pharmacist", "patient"}
        and incoming_role != existing.speaker_role
    ):
        return False

    cur_dur = max(0.0, incoming_end_sec - incoming_start_sec)
    seg_dur = max(0.0, existing.end_sec - existing.start_sec)
    union = max(existing.end_sec, incoming_end_sec) - min(existing.start_sec, incoming_start_sec)
    iou = inter / union if union > 0 else 0.0
    shorter = min(seg_dur, cur_dur)
    containment = inter / shorter if shorter > 0 else 0.0
    if not (iou >= 0.40 or containment >= 0.55):
        return False

    same_known_role = (
        incoming_role in {"pharmacist", "patient"} and incoming_role == existing.speaker_role
    )
    if same_known_role:
        return True

    norm_in = _strip_text_for_match(incoming_text)
    norm_ex = _strip_text_for_match(existing.text)
    min_chars = min(len(norm_in), len(norm_ex))
    jaccard = _char_bigram_jaccard(norm_in, norm_ex)
    overlap_coeff = _char_bigram_overlap_coeff(norm_in, norm_ex)

    in_rms = overlap_levels[incoming_channel]
    ex_rms = overlap_levels[existing.channel_index]
    dominant_rms = max(in_rms, ex_rms)
    weaker_rms = min(in_rms, ex_rms)

    # 文字内容が一致・包含される重複（句読点・語尾違い・長短分割ズレに対応）
    if min_chars >= 4 and (
        jaccard >= 0.50 or overlap_coeff >= 0.70 or norm_in in norm_ex or norm_ex in norm_in
    ):
        return True

    # 短文（「はい」等）は同一文かつ明確な音量劣位の場合のみ回り込み扱いとし、同時相槌を保護する
    if (
        min_chars >= 1
        and norm_in == norm_ex
        and containment >= 0.65
        and dominant_rms >= max(weaker_rms * 2.2, 0.01)
    ):
        return True

    # 片側のみ unknown で 4 文字以上かつ時刻大部分重畳＋明確な音量優位側がある場合も回り込みとみなす
    one_unknown = (incoming_role == "unknown") != (existing.speaker_role == "unknown")
    if one_unknown and min_chars >= 4 and containment >= 0.65:
        known_rms = in_rms if incoming_role != "unknown" else ex_rms
        unknown_rms = ex_rms if incoming_role != "unknown" else in_rms
        if known_rms >= max(unknown_rms * 1.35, 0.01):
            return True

    return False


def _should_prefer_incoming_duplicate(
    *,
    incoming_channel: int,
    incoming_role: SpeakerRole,
    incoming_confidence: float,
    incoming_text: str,
    existing: TranscriptSegmentModel,
    overlap_levels: tuple[float, float],
) -> bool:
    """重複ペアから残すべきチャンネル側を判定する（True なら受信側を優先して既存を削除）。"""
    in_rank = 1 if incoming_role in {"pharmacist", "patient"} else 0
    ex_rank = 1 if existing.speaker_role in {"pharmacist", "patient"} else 0
    if in_rank != ex_rank:
        return in_rank > ex_rank

    in_rms = overlap_levels[incoming_channel]
    ex_rms = overlap_levels[existing.channel_index]
    if in_rms > 0.0 or ex_rms > 0.0:
        if in_rms >= ex_rms * 1.25:
            return True
        if ex_rms >= in_rms * 1.25:
            return False

    target_role = (
        incoming_role if incoming_role in {"pharmacist", "patient"} else existing.speaker_role
    )
    preferred_ch = _preferred_channel_for_role(target_role)
    if preferred_ch is not None:
        if incoming_channel == preferred_ch and existing.channel_index != preferred_ch:
            return True
        if existing.channel_index == preferred_ch and incoming_channel != preferred_ch:
            return False

    in_len = len(_strip_text_for_match(incoming_text))
    ex_len = len(_strip_text_for_match(existing.text))
    return (round(incoming_confidence, 3), in_len) > (round(existing.confidence, 3), ex_len)


def is_crosstalk_duplicate(
    segments: list[TranscriptSegmentModel],
    *,
    stream_id: str,
    channel_index: int,
    text: str,
    start_sec: float,
    end_sec: float,
    recent_channel_levels: tuple[float, float],
    dominance_ratio: float = 3.0,
    speaker_role: SpeakerRole | None = None,
    used_voiceprint: bool = False,
    noise_floor: tuple[float, float] = (0.002, 0.002),
) -> bool:
    """時刻重畳・音量差・文字列/声紋一致が揃う回り込み重複のみ除外する。"""
    if channel_index not in {0, 1}:
        return False

    self_level = recent_channel_levels[channel_index]
    other_index = 1 if channel_index == 0 else 0
    other_level = recent_channel_levels[other_index]
    normalized = re.sub(r"\s+", "", text)

    # 短い返答（「はい」「いいえ」等）は同時発話保持を最優先し、回り込みとして削除しない
    if len(normalized) < 6:
        return False

    # 話者照合が有効でない従来モードでは既定 8 文字以上・3.0 倍差・完全一致のみ除外
    if not used_voiceprint and len(normalized) < 8:
        return False

    min_other = max(0.012, noise_floor[other_index] * 2.5) if used_voiceprint else 0.025
    effective_ratio = 1.8 if used_voiceprint else dominance_ratio
    if other_level < min_other or other_level <= self_level * effective_ratio:
        return False

    cur_dur = max(0.0, end_sec - start_sec)
    for segment in segments:
        if (
            segment.stream_id != stream_id
            or segment.channel_index != other_index
            or segment.status == "interim"
        ):
            continue
        inter = max(0.0, min(segment.end_sec, end_sec) - max(segment.start_sec, start_sec))
        if inter <= 0.0:
            continue
        seg_dur = max(0.0, segment.end_sec - segment.start_sec)
        longest = max(seg_dur, cur_dur)
        union = max(segment.end_sec, end_sec) - min(segment.start_sec, start_sec)
        iou = inter / union if union > 0 else 0.0

        if not used_voiceprint:
            if (
                longest > 0
                and inter >= longest * 0.8
                and re.sub(r"\s+", "", segment.text) == normalized
            ):
                return True
            continue

        # 声紋有効時は境界ズレ・語尾揺れに対応（別話者判定時は同時発話として必ず保持）
        if (
            speaker_role in {"pharmacist", "patient"}
            and segment.speaker_role in {"pharmacist", "patient"}
            and speaker_role != segment.speaker_role
        ):
            continue
        shorter = min(seg_dur, cur_dur)
        overlap_ok = iou >= 0.45 or (shorter > 0 and inter >= shorter * 0.65)
        if not overlap_ok:
            continue
        txt_sim = _char_bigram_jaccard(segment.text, text)
        same_known_role = (
            speaker_role in {"pharmacist", "patient"} and speaker_role == segment.speaker_role
        )
        if txt_sim >= 0.70 or (same_known_role and txt_sim >= 0.45):
            return True
    return False


class ConversationTranscriptState:
    """1会話内の発話セグメント・版番号・回り込み除外候補の正となる状態管理。"""

    def __init__(
        self,
        *,
        conversation_id: str,
        speaker_tracker: ConversationSpeakerTracker | None = None,
        pcm_history_seconds: float | None = None,
    ) -> None:
        self.conversation_id = conversation_id
        self.transcript_revision = 0
        self._next_segment_seq = 1
        self._next_stream_seq = 0
        self._current_stream_id = ""
        self._stream_orders: dict[str, int] = {}
        self._segments: list[TranscriptSegmentModel] = []
        self._segment_index_by_key: dict[tuple[str, str], int] = {}
        self._suppressed_candidates: list[TranscriptSegmentModel] = []
        self._active_interim_ids: dict[tuple[str, int], str] = {}
        self._manual_speaker_overrides: set[tuple[str, str]] = set()
        self._audio_history = BackendAudioLevelHistory()
        self._pcm_buffer = BackendAudioPcmRingBuffer(max_history_seconds=pcm_history_seconds)
        self._speaker_tracker = speaker_tracker or ConversationSpeakerTracker()

    @property
    def speaker_tracker(self) -> ConversationSpeakerTracker:
        return self._speaker_tracker

    @property
    def segments(self) -> list[TranscriptSegmentModel]:
        return list(self._segments)

    @property
    def suppressed_candidates(self) -> list[TranscriptSegmentModel]:
        return list(self._suppressed_candidates)

    @property
    def finalized_segments(self) -> list[TranscriptSegmentModel]:
        return [segment for segment in self._segments if segment.status != "interim"]

    def set_pharmacist_profile(
        self,
        *,
        model_id: str,
        embedding: Sequence[float],
    ) -> tuple[bool, str | None]:
        """ブラウザから受け取った薬剤師声紋をこの会話の一時状態へ登録する。"""
        return self._speaker_tracker.set_pharmacist_profile(
            model_id=model_id,
            embedding=embedding,
        )

    def clear_pcm_buffer(self) -> None:
        """録音停止時等に直近 PCM 生音声バッファだけを破棄する。"""
        self._pcm_buffer.clear()

    def clear_speaker_memory(self) -> None:
        """会話終了時に音声バッファと一時的な患者声紋をメモリから破棄する。"""
        self._pcm_buffer.clear()
        self._audio_history.reset_timeline()
        self._speaker_tracker.clear_ephemeral_patient_state()

    def needs_speaker_embedding(self, event: DeepgramTranscriptInput) -> bool:
        """当該イベントに対して話者埋め込み抽出を行うべきか判定する。"""
        if not event.is_final or not self._speaker_tracker.has_pharmacist_profile:
            return False
        duration = max(0.0, event.end_sec - event.start_sec)
        min_sec = SpeakerMatchThresholds.from_settings().min_embed_sec
        return (
            duration >= min_sec
            or duration + sum(s.end_sec - s.start_sec for s in self._pending_short_segments(event))
            >= min_sec
        )

    def needs_turn_split_probe(self, event: DeepgramTranscriptInput) -> bool:
        """1発話内に別話者が混在しうる長尺セグメントかを判定する。"""
        if not event.is_final or not self._speaker_tracker.has_pharmacist_profile:
            return False
        if len(event.words) < 2:
            return False
        min_sec = SpeakerMatchThresholds.from_settings().min_embed_sec
        return (event.end_sec - event.start_sec) >= min_sec * 2.0

    def classify_probe_segment(
        self,
        *,
        channel_index: int,
        start_sec: float,
        end_sec: float,
        segment_embedding: Sequence[float] | None,
    ) -> SpeakerRole:
        """会話状態を書き換えずに候補区間の話者ロールを試験判定する。"""
        levels = self._audio_history.levels_for(start_sec, end_sec)
        noise_floor = self._pcm_buffer.estimate_noise_floor()
        return self._speaker_tracker.verify_segment(
            channel_index=channel_index,
            duration_sec=max(0.0, end_sec - start_sec),
            channel_levels=levels,
            segment_embedding=segment_embedding,
            noise_floor=noise_floor,
            mutate_patient_centroid=False,
        ).speaker_role

    def override_segment_speaker(
        self,
        *,
        stream_id: str,
        segment_id: str,
        speaker_role: SpeakerRole,
    ) -> TranscriptSegmentModel | None:
        """確定済み発話の話者ロールを手動訂正し、自動再訂正対象から保護する。"""
        key = (stream_id, segment_id)
        idx = self._segment_index_by_key.get(key)
        if idx is None:
            return None
        existing = self._segments[idx]
        if existing.status == "interim":
            return None
        self._manual_speaker_overrides.add(key)
        if existing.speaker_role == speaker_role:
            return None
        self.transcript_revision += 1
        updated = existing.model_copy(
            update={
                "segment_revision": existing.segment_revision + 1,
                "transcript_revision": self.transcript_revision,
                "speaker_role": speaker_role,
                "speaker_label": SPEAKER_LABEL_BY_ROLE[speaker_role],
                "status": "refined",
            }
        )
        self._segments[idx] = updated
        return updated

    def delete_segment(
        self,
        *,
        stream_id: str,
        segment_id: str,
    ) -> TranscriptSegmentModel | None:
        """重複・不要な確定済み発話を会話レジストリから削除する。"""
        key = (stream_id, segment_id)
        idx = self._segment_index_by_key.get(key)
        if idx is None:
            return None
        existing = self._segments[idx]
        if existing.status == "interim":
            return None
        self._segments.pop(idx)
        self._manual_speaker_overrides.discard(key)
        self._rebuild_index()
        self.transcript_revision += 1
        return existing

    def speaker_embedding_interval(self, event: DeepgramTranscriptInput) -> tuple[float, float]:
        """近接した短発話を蓄積できる場合は、再照合対象全体の区間を返す。"""
        pending = self._pending_short_segments(event)
        return (pending[0].start_sec if pending else event.start_sec, event.end_sec)

    def _pending_short_segments(
        self, event: DeepgramTranscriptInput
    ) -> list[TranscriptSegmentModel]:
        """同一マイク優位・近接・非重畳の未確定話者だけを短発話の蓄積候補にする。"""
        thresholds = SpeakerMatchThresholds.from_settings()
        if not event.is_final or event.end_sec - event.start_sec >= thresholds.min_embed_sec:
            return []
        channel = event.channel_index
        if channel not in {0, 1}:
            return []

        def dominant(start: float, end: float) -> bool:
            levels = self._audio_history.levels_for(start, end)
            return (
                levels[channel] >= thresholds.min_active_rms
                and levels[channel] >= levels[1 - channel] * thresholds.rms_dominance_ratio
            )

        if not dominant(event.start_sec, event.end_sec):
            return []
        pending: list[TranscriptSegmentModel] = []
        next_start = event.start_sec
        finals = [
            s
            for s in self._segments
            if s.stream_id == self._current_stream_id and s.status != "interim"
        ]
        for seg in reversed(finals):
            if seg.end_sec > next_start:
                if seg.channel_index != channel and seg.start_sec < event.end_sec:
                    break
                continue
            if (
                seg.channel_index != channel
                or seg.speaker_role != "unknown"
                or (seg.stream_id, seg.segment_id) in self._manual_speaker_overrides
                or seg.end_sec - seg.start_sec >= thresholds.min_embed_sec
                or not 0 <= next_start - seg.end_sec <= 0.35
                or not dominant(seg.start_sec, seg.end_sec)
            ):
                break
            if any(
                s.channel_index != channel
                and s.start_sec < event.end_sec
                and s.end_sec > seg.start_sec
                for s in finals
            ):
                break
            pending.insert(0, seg)
            next_start = seg.start_sec
            if len(pending) >= 4:
                break
        return pending

    def slice_pcm16(self, start_sec: float, end_sec: float) -> tuple[bytes, int, int] | None:
        """指定区間の 2ch/1ch PCM16 音声をリングバッファから取得する。"""
        return self._pcm_buffer.slice_pcm16(start_sec, end_sec)

    def start_stream(self, stream_id: str | None = None) -> str:
        """新しい WebSocket 接続 / 収音開始ごとのストリームを開始する。"""
        self._next_stream_seq += 1
        resolved_id = (stream_id or "").strip() or f"stream-{self._next_stream_seq}"
        self._current_stream_id = resolved_id
        self._stream_orders[resolved_id] = self._next_stream_seq
        self._audio_history.reset_timeline()
        self._pcm_buffer.clear()
        return resolved_id

    def append_pcm16(self, pcm16_bytes: bytes, *, channels: int, sample_rate: int) -> None:
        usable_bytes = (
            len(pcm16_bytes) - (len(pcm16_bytes) % (2 * channels)) if channels in {1, 2} else 0
        )
        if usable_bytes > 0 and sample_rate > 0:
            levels = compute_pcm16_channel_rms(pcm16_bytes[:usable_bytes], channels=channels)
            duration = usable_bytes / (2 * channels * sample_rate)
            self._audio_history.append_levels(duration_sec=duration, levels=levels)
            self._pcm_buffer.append_pcm16(
                pcm16_bytes[:usable_bytes],
                channels=channels,
                sample_rate=sample_rate,
                levels=levels,
            )

    def append_audio_levels(self, *, duration_sec: float, levels: tuple[float, float]) -> None:
        self._audio_history.append_levels(duration_sec=duration_sec, levels=levels)

    def get_segment(
        self, *, stream_id: str, segment_id: str, segment_revision: int | None = None
    ) -> TranscriptSegmentModel | None:
        idx = self._segment_index_by_key.get((stream_id, segment_id))
        if idx is None:
            return None
        segment = self._segments[idx]
        if segment_revision is not None and segment.segment_revision != segment_revision:
            return None
        return segment

    def apply_deepgram_event(
        self,
        event: DeepgramTranscriptInput,
        *,
        stream_id: str | None = None,
        single_stream_diarized: bool = False,
        segment_embedding: Sequence[float] | None = None,
    ) -> TranscriptApplyOutcome:
        """Deepgram の認識結果を正規化し、話者照合・回り込み統合・後続再評価の結果を返す。"""
        text = event.text.strip()
        if not text:
            return TranscriptApplyOutcome(segment=None)

        target_stream = stream_id or self._current_stream_id or self.start_stream()
        channel: int = 1 if event.channel_index == 1 else 0
        speaker_role, speaker_label = SPEAKER_ROLE_BY_CHANNEL[channel]
        if not single_stream_diarized and self._speaker_tracker.voiceprint_requested:
            # 声紋判定前の途中結果や登録拒否後に、マイク番号由来の誤った話者名を出さない
            speaker_role = "unknown"
            speaker_label = SPEAKER_LABEL_BY_ROLE["unknown"]
        # 1ch ミックスモードでは同一ストリーム内で話者が切り替わってもゴースト interim を残さない
        interim_key = (target_stream, 0 if single_stream_diarized else channel)
        active_interim_id = self._active_interim_ids.get(interim_key)
        levels = (0.0, 0.0)
        voiceprint_active = self._speaker_tracker.has_pharmacist_profile
        pending_short = self._pending_short_segments(event) if not single_stream_diarized else []
        matched_embedding = False

        removed_segments: list[TranscriptSegmentModel] = []
        if event.is_final and not single_stream_diarized:
            levels = self._audio_history.levels_for(event.start_sec, event.end_sec)
            noise_floor = self._pcm_buffer.estimate_noise_floor()
            if voiceprint_active:
                decision = self._speaker_tracker.verify_segment(
                    channel_index=channel,
                    duration_sec=max(0.0, event.end_sec - event.start_sec)
                    + (
                        sum(s.end_sec - s.start_sec for s in pending_short)
                        if segment_embedding is not None
                        else 0.0
                    ),
                    channel_levels=levels,
                    segment_embedding=segment_embedding,
                    noise_floor=noise_floor,
                )
                speaker_role = decision.speaker_role
                speaker_label = decision.speaker_label
                matched_embedding = decision.used_embedding

                suppress_incoming, evict_indices = self._evaluate_voiceprint_channel_duplicates(
                    target_stream=target_stream,
                    channel=channel,
                    text=text,
                    start_sec=event.start_sec,
                    end_sec=event.end_sec,
                    confidence=event.confidence,
                    speaker_role=speaker_role,
                    levels=levels,
                )
                if suppress_incoming:
                    return self._suppress_incoming_crosstalk(
                        target_stream=target_stream,
                        interim_key=interim_key,
                        active_interim_id=active_interim_id,
                        channel=channel,
                        speaker_role=speaker_role,
                        speaker_label=speaker_label,
                        text=text,
                        event=event,
                    )
                if evict_indices:
                    for evict_idx in sorted(evict_indices, reverse=True):
                        evicted = self._segments.pop(evict_idx)
                        self._suppressed_candidates.append(evicted)
                        removed_segments.append(evicted)
                    self._rebuild_index()
            elif is_crosstalk_duplicate(
                self._segments,
                stream_id=target_stream,
                channel_index=channel,
                text=text,
                start_sec=event.start_sec,
                end_sec=event.end_sec,
                recent_channel_levels=levels,
                speaker_role=speaker_role,
                used_voiceprint=False,
                noise_floor=noise_floor,
            ):
                return self._suppress_incoming_crosstalk(
                    target_stream=target_stream,
                    interim_key=interim_key,
                    active_interim_id=active_interim_id,
                    channel=channel,
                    speaker_role=speaker_role,
                    speaker_label=speaker_label,
                    text=text,
                    event=event,
                )

        next_status: TranscriptStatus = "final" if event.is_final else "interim"
        self.transcript_revision += 1

        if active_interim_id is not None:
            idx = self._segment_index_by_key[(target_stream, active_interim_id)]
            previous = self._segments[idx]
            result_segment = TranscriptSegmentModel(
                stream_id=target_stream,
                segment_id=previous.segment_id,
                segment_revision=previous.segment_revision + 1,
                transcript_revision=self.transcript_revision,
                channel_index=1 if channel == 1 else 0,
                speaker_role=speaker_role,
                speaker_label=speaker_label,
                text=text,
                status=next_status,
                start_sec=max(0.0, event.start_sec),
                end_sec=max(event.start_sec, event.end_sec),
                confidence=max(0.0, min(1.0, event.confidence)),
                speech_final=event.speech_final,
            )
            self._segments[idx] = result_segment
            if event.is_final:
                self._active_interim_ids.pop(interim_key, None)
        else:
            segment_id = f"seg-{self._next_segment_seq}"
            self._next_segment_seq += 1
            result_segment = TranscriptSegmentModel(
                stream_id=target_stream,
                segment_id=segment_id,
                segment_revision=1,
                transcript_revision=self.transcript_revision,
                channel_index=1 if channel == 1 else 0,
                speaker_role=speaker_role,
                speaker_label=speaker_label,
                text=text,
                status=next_status,
                start_sec=max(0.0, event.start_sec),
                end_sec=max(event.start_sec, event.end_sec),
                confidence=max(0.0, min(1.0, event.confidence)),
                speech_final=event.speech_final,
            )
            self._segments.append(result_segment)
            if not event.is_final:
                self._active_interim_ids[interim_key] = segment_id

        self._sort_segments_preserving_audio_order()
        refined: tuple[TranscriptSegmentModel, ...] = ()
        if (
            event.is_final
            and not single_stream_diarized
            and voiceprint_active
            and matched_embedding
            and speaker_role in {"pharmacist", "patient"}
        ):
            refined = self._refine_preceding_unknown_short_segments(
                target_stream=target_stream,
                anchor=result_segment,
                candidates=pending_short,
            )

        return TranscriptApplyOutcome(
            segment=result_segment,
            is_new_final=event.is_final,
            suppressed_crosstalk=bool(removed_segments),
            refined_segments=refined,
            removed_segments=tuple(removed_segments),
        )

    def _evaluate_voiceprint_channel_duplicates(
        self,
        *,
        target_stream: str,
        channel: int,
        text: str,
        start_sec: float,
        end_sec: float,
        confidence: float,
        speaker_role: SpeakerRole,
        levels: tuple[float, float],
    ) -> tuple[bool, list[int]]:
        """他チャンネル確定発話との重複を比較し、(受信側除外, 置換対象index群) を返す。"""
        other_index = 1 if channel == 0 else 0
        evict_indices: list[int] = []
        for idx, seg in enumerate(self._segments):
            if (
                seg.stream_id != target_stream
                or seg.channel_index != other_index
                or seg.status == "interim"
            ):
                continue
            ov_start = max(seg.start_sec, start_sec)
            ov_end = min(seg.end_sec, end_sec)
            overlap_levels = (
                self._audio_history.levels_for(ov_start, ov_end)
                if ov_end - ov_start >= 0.05
                else (0.0, 0.0)
            )
            if max(overlap_levels) <= 0.0:
                overlap_levels = levels
            if not _is_voiceprint_channel_duplicate(
                incoming_text=text,
                incoming_start_sec=start_sec,
                incoming_end_sec=end_sec,
                incoming_role=speaker_role,
                incoming_channel=channel,
                existing=seg,
                overlap_levels=overlap_levels,
            ):
                continue
            if _should_prefer_incoming_duplicate(
                incoming_channel=channel,
                incoming_role=speaker_role,
                incoming_confidence=confidence,
                incoming_text=text,
                existing=seg,
                overlap_levels=overlap_levels,
            ):
                evict_indices.append(idx)
            else:
                return True, []
        return False, evict_indices

    def _suppress_incoming_crosstalk(
        self,
        *,
        target_stream: str,
        interim_key: tuple[str, int],
        active_interim_id: str | None,
        channel: int,
        speaker_role: SpeakerRole,
        speaker_label: str,
        text: str,
        event: DeepgramTranscriptInput,
    ) -> TranscriptApplyOutcome:
        """受信側の回り込み重複発話を履歴に退避し、アクティブ interim があれば取り下げる。"""
        removed_segment: TranscriptSegmentModel | None = None
        if active_interim_id is not None:
            self._active_interim_ids.pop(interim_key, None)
            idx = self._segment_index_by_key.pop((target_stream, active_interim_id), None)
            if idx is not None:
                removed_segment = self._segments.pop(idx)
                self._rebuild_index()
        archived = TranscriptSegmentModel(
            stream_id=target_stream,
            segment_id=active_interim_id or f"suppressed-{self._next_segment_seq}",
            segment_revision=1,
            transcript_revision=max(1, self.transcript_revision),
            channel_index=1 if channel == 1 else 0,
            speaker_role=speaker_role,
            speaker_label=speaker_label,
            text=text,
            status="final",
            start_sec=max(0.0, event.start_sec),
            end_sec=max(event.start_sec, event.end_sec),
            confidence=max(0.0, min(1.0, event.confidence)),
            speech_final=event.speech_final,
        )
        self._suppressed_candidates.append(archived)
        return TranscriptApplyOutcome(
            segment=removed_segment,
            removed=removed_segment is not None,
            is_new_final=False,
            suppressed_crosstalk=True,
        )

    def _refine_preceding_unknown_short_segments(
        self,
        *,
        target_stream: str,
        anchor: TranscriptSegmentModel,
        candidates: list[TranscriptSegmentModel],
    ) -> tuple[TranscriptSegmentModel, ...]:
        """蓄積音声の声紋照合が成功した短発話だけを訂正する。"""
        refined: list[TranscriptSegmentModel] = []
        for prev in candidates:
            idx = self._segment_index_by_key.get((target_stream, prev.segment_id))
            if idx is None:
                continue
            self.transcript_revision += 1
            updated = prev.model_copy(
                update={
                    "segment_revision": prev.segment_revision + 1,
                    "transcript_revision": self.transcript_revision,
                    "speaker_role": anchor.speaker_role,
                    "speaker_label": SPEAKER_LABEL_BY_ROLE[anchor.speaker_role],
                    "status": "refined",
                }
            )
            self._segments[idx] = updated
            refined.append(updated)
        return tuple(refined)

    def _sort_segments_preserving_audio_order(self) -> None:
        def _sort_key(segment: TranscriptSegmentModel) -> tuple[int, float, int]:
            stream_order = self._stream_orders.get(segment.stream_id, 0)
            seq = (
                int(segment.segment_id.removeprefix("seg-"))
                if segment.segment_id.startswith("seg-")
                else 0
            )
            return (stream_order, segment.start_sec, seq)

        self._segments.sort(key=_sort_key)
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        self._segment_index_by_key = {
            (segment.stream_id, segment.segment_id): idx
            for idx, segment in enumerate(self._segments)
        }
