import array
import math
import re
from collections import deque
from dataclasses import dataclass

from app.schemas.soap import SpeakerRole, TranscriptSegmentModel, TranscriptStatus

SPEAKER_ROLE_BY_CHANNEL: dict[int, tuple[SpeakerRole, str]] = {
    0: ("pharmacist", "薬剤師"),
    1: ("patient", "患者"),
}


@dataclass(frozen=True)
class _AudioChunk:
    start: float
    end: float
    levels: tuple[float, float]


def compute_pcm16_channel_rms(pcm16_bytes: bytes, *, channels: int) -> tuple[float, float]:
    """16bit リトルエンディアン PCM からチャンネルごとの正規化 RMS (0.0〜1.0) を算出する。"""
    if channels not in {1, 2} or len(pcm16_bytes) < 2:
        return (0.0, 0.0)

    usable_len = len(pcm16_bytes) - (len(pcm16_bytes) % (2 * channels))
    if usable_len <= 0:
        return (0.0, 0.0)

    samples = array.array("h")
    samples.frombytes(pcm16_bytes[:usable_len])
    frame_count = len(samples) // channels
    if frame_count <= 0:
        return (0.0, 0.0)

    if channels == 1:
        sum_sq = sum(float(sample) * float(sample) for sample in samples)
        rms0 = min(1.0, math.sqrt(sum_sq / frame_count) / 32768.0)
        return (rms0, 0.0)

    sum_sq_0 = 0.0
    sum_sq_1 = 0.0
    for idx in range(0, len(samples), 2):
        left = float(samples[idx])
        right = float(samples[idx + 1])
        sum_sq_0 += left * left
        sum_sq_1 += right * right
    rms0 = min(1.0, math.sqrt(sum_sq_0 / frame_count) / 32768.0)
    rms1 = min(1.0, math.sqrt(sum_sq_1 / frame_count) / 32768.0)
    return (rms0, rms1)


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
    """発話正規化の適用結果。"""

    segment: TranscriptSegmentModel | None
    removed: bool = False
    is_new_final: bool = False
    suppressed_crosstalk: bool = False


def is_crosstalk_duplicate(
    segments: list[TranscriptSegmentModel],
    *,
    stream_id: str,
    channel_index: int,
    text: str,
    start_sec: float,
    end_sec: float,
    recent_channel_levels: tuple[float, float],
    dominance_ratio: float = 1.35,
) -> bool:
    """2マイク環境での回り込み二重確定を音量差と時刻重複から判定する。"""
    if channel_index not in {0, 1}:
        return False

    self_level = recent_channel_levels[channel_index]
    other_index = 1 if channel_index == 0 else 0
    other_level = recent_channel_levels[other_index]

    if other_level < 0.025 or other_level <= self_level * dominance_ratio:
        return False

    normalized = re.sub(r"\s+", "", text)
    if not normalized:
        return False

    for segment in segments:
        if (
            segment.stream_id != stream_id
            or segment.channel_index != other_index
            or segment.status == "interim"
        ):
            continue
        if min(segment.end_sec, end_sec) <= max(segment.start_sec, start_sec):
            continue
        if re.sub(r"\s+", "", segment.text) == normalized:
            return True
    return False


class ConversationTranscriptState:
    """1会話内の発話セグメント・版番号・回り込み除外候補の正となる状態管理。"""

    def __init__(self, *, conversation_id: str) -> None:
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

    @property
    def segments(self) -> list[TranscriptSegmentModel]:
        return list(self._segments)

    @property
    def suppressed_candidates(self) -> list[TranscriptSegmentModel]:
        return list(self._suppressed_candidates)

    @property
    def finalized_segments(self) -> list[TranscriptSegmentModel]:
        return [segment for segment in self._segments if segment.status != "interim"]

    def start_stream(self, stream_id: str | None = None) -> str:
        """新しい WebSocket 接続 / 収音開始ごとのストリームを開始する。"""
        self._next_stream_seq += 1
        resolved_id = (stream_id or "").strip() or f"stream-{self._next_stream_seq}"
        self._current_stream_id = resolved_id
        self._stream_orders[resolved_id] = self._next_stream_seq
        self._audio_history.reset_timeline()
        return resolved_id

    def append_pcm16(self, pcm16_bytes: bytes, *, channels: int, sample_rate: int) -> None:
        self._audio_history.append_pcm16(pcm16_bytes, channels=channels, sample_rate=sample_rate)

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
    ) -> TranscriptApplyOutcome:
        """Deepgram の認識結果を正規化し、発話状態の更新結果（と回り込み除外）を返す。"""
        text = event.text.strip()
        if not text:
            return TranscriptApplyOutcome(segment=None)

        target_stream = stream_id or self._current_stream_id or self.start_stream()
        channel: int = 1 if event.channel_index == 1 else 0
        speaker_role, speaker_label = SPEAKER_ROLE_BY_CHANNEL[channel]
        interim_key = (target_stream, channel)
        active_interim_id = self._active_interim_ids.get(interim_key)

        if event.is_final:
            levels = self._audio_history.levels_for(event.start_sec, event.end_sec)
            if is_crosstalk_duplicate(
                self._segments,
                stream_id=target_stream,
                channel_index=channel,
                text=text,
                start_sec=event.start_sec,
                end_sec=event.end_sec,
                recent_channel_levels=levels,
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
            updated = TranscriptSegmentModel(
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
            self._segments[idx] = updated
            if event.is_final:
                self._active_interim_ids.pop(interim_key, None)
            self._sort_segments_preserving_audio_order()
            return TranscriptApplyOutcome(
                segment=updated,
                is_new_final=event.is_final,
            )

        segment_id = f"seg-{self._next_segment_seq}"
        self._next_segment_seq += 1
        created = TranscriptSegmentModel(
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
        self._segments.append(created)
        if not event.is_final:
            self._active_interim_ids[interim_key] = segment_id
        self._sort_segments_preserving_audio_order()
        return TranscriptApplyOutcome(
            segment=created,
            is_new_final=event.is_final,
        )

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
