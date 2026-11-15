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
        if not parts or covered < (end_sec - start_sec) * 0.5:
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
class DeepgramTranscriptInput:
    """Deepgram 受信メッセージから正規化へ渡す抽出済みデータ。"""

    channel_index: int
    text: str
    is_final: bool
    speech_final: bool
    start_sec: float
    end_sec: float
    confidence: float


@dataclass(frozen=True)
class TranscriptApplyOutcome:
    """発話正規化の適用結果（後続再評価による訂正セグメント群を含む）。"""

    segment: TranscriptSegmentModel | None
    removed: bool = False
    is_new_final: bool = False
    suppressed_crosstalk: bool = False
    refined_segments: tuple[TranscriptSegmentModel, ...] = ()


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
        return duration >= min_sec

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
        # 1ch ミックスモードでは同一ストリーム内で話者が切り替わってもゴースト interim を残さない
        interim_key = (target_stream, 0 if single_stream_diarized else channel)
        active_interim_id = self._active_interim_ids.get(interim_key)
        levels = (0.0, 0.0)
        voiceprint_active = self._speaker_tracker.has_pharmacist_profile

        if event.is_final and not single_stream_diarized:
            levels = self._audio_history.levels_for(event.start_sec, event.end_sec)
            noise_floor = self._pcm_buffer.estimate_noise_floor()
            if voiceprint_active:
                decision = self._speaker_tracker.verify_segment(
                    channel_index=channel,
                    duration_sec=max(0.0, event.end_sec - event.start_sec),
                    channel_levels=levels,
                    segment_embedding=segment_embedding,
                    noise_floor=noise_floor,
                )
                speaker_role = decision.speaker_role
                speaker_label = decision.speaker_label

            if is_crosstalk_duplicate(
                self._segments,
                stream_id=target_stream,
                channel_index=channel,
                text=text,
                start_sec=event.start_sec,
                end_sec=event.end_sec,
                recent_channel_levels=levels,
                speaker_role=speaker_role,
                used_voiceprint=voiceprint_active,
                noise_floor=noise_floor,
            ):
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
            and speaker_role in {"pharmacist", "patient"}
        ):
            refined = self._refine_preceding_unknown_short_segments(
                target_stream=target_stream,
                anchor=result_segment,
                anchor_levels=levels,
            )

        return TranscriptApplyOutcome(
            segment=result_segment,
            is_new_final=event.is_final,
            refined_segments=refined,
        )

    def _refine_preceding_unknown_short_segments(
        self,
        *,
        target_stream: str,
        anchor: TranscriptSegmentModel,
        anchor_levels: tuple[float, float],
    ) -> tuple[TranscriptSegmentModel, ...]:
        """確定した直後の同一チャンネル発話を手がかりに、直前の短い unknown 発話を再判定する。"""
        other_ch = 1 if anchor.channel_index == 0 else 0
        if anchor_levels[anchor.channel_index] <= anchor_levels[other_ch] * 1.2:
            return ()

        min_embed = SpeakerMatchThresholds.from_settings().min_embed_sec
        anchor_idx = self._segment_index_by_key.get((target_stream, anchor.segment_id))
        if anchor_idx is None or anchor_idx == 0:
            return ()

        prev = self._segments[anchor_idx - 1]
        if (
            prev.stream_id != target_stream
            or prev.status != "final"
            or prev.speaker_role != "unknown"
            or prev.channel_index != anchor.channel_index
        ):
            return ()

        prev_dur = max(0.0, prev.end_sec - prev.start_sec)
        gap = anchor.start_sec - prev.end_sec
        if prev_dur >= min_embed or gap < -0.2 or gap > 1.5:
            return ()

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
        self._segments[anchor_idx - 1] = updated
        return (updated,)

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
