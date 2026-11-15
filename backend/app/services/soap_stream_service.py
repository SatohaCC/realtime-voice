import asyncio
import json
import time
import uuid
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Literal, Protocol

from pydantic import ValidationError

from app.clients.deepgram_client import (
    DeepgramClientError,
    DeepgramStreamProtocol,
)
from app.clients.soap_llm_client import (
    SoapLlmClientError,
    SoapLlmClientProtocol,
    get_default_soap_llm_client,
)
from app.clients.speaker_embedding_client import (
    SpeakerEmbeddingClientError,
    SpeakerEmbeddingClientProtocol,
    get_default_speaker_embedding_client,
)
from app.core.config import settings
from app.schemas.soap import (
    ConversationCompletedEvent,
    ConversationSnapshotEvent,
    SoapLifecycleStatus,
    SoapStatusEvent,
    SoapUpdatedEvent,
    SpeakerRole,
    TranscriptUpdatedEvent,
)
from app.schemas.speaker import (
    SegmentSpeakerOverrideFrame,
    SpeakerProfileAckEvent,
    SpeakerProfileFrame,
)
from app.schemas.transcription import TranscriptionErrorEvent, TranscriptionStreamConfig
from app.services.audio_vad_service import AudioActivityGate, AudioGateConfig
from app.services.conversation_service import (
    ConversationTranscriptState,
    DeepgramTranscriptInput,
    DeepgramWordTiming,
    build_word_clause_candidates,
    join_deepgram_words,
)
from app.services.soap_service import SoapStateManager
from app.services.speaker_audio_service import select_speaker_audio

_QueuePriority = Literal["high", "status", "interim"]


class StreamClientWebSocketProtocol(Protocol):
    """WebSocket 送受信プロトコル。"""

    async def receive_message(self) -> bytes | str | None: ...

    async def send_text(self, text: str) -> None: ...


class OutboundQueueOverflowError(Exception):
    """クライアント向け送信キューが上限に達したことを示す内部エラー。"""


class BoundedWsOutboundQueue:
    """単一 writer 向けの有界送信キュー（確定発話や完了通知を優先して保護する）。"""

    def __init__(self, *, maxsize: int) -> None:
        self._maxsize = max(4, maxsize)
        self._items: deque[tuple[_QueuePriority, str]] = deque()
        self._closed = False
        self._wake = asyncio.Event()

    def enqueue(self, payload: str, *, priority: _QueuePriority) -> None:
        if self._closed:
            return
        if len(self._items) >= self._maxsize:
            if priority == "interim":
                # 受信が追いつかないときは interim を間引き、確定発話と完了通知を守る
                return
            if not self._evict_oldest_droppable():
                raise OutboundQueueOverflowError("送信キューの上限に達したため接続を終了します。")
        self._items.append((priority, payload))
        self._wake.set()

    def close(self) -> None:
        self._closed = True
        self._wake.set()

    async def drain_to(self, send_text: Callable[[str], Awaitable[None]]) -> None:
        while True:
            while self._items:
                _, payload = self._items.popleft()
                await send_text(payload)
            if self._closed:
                return
            self._wake.clear()
            if not self._items and not self._closed:
                await self._wake.wait()

    def _evict_oldest_droppable(self) -> bool:
        for idx, (prio, _) in enumerate(self._items):
            if prio == "interim":
                del self._items[idx]
                return True
        for idx, (prio, _) in enumerate(self._items):
            if prio == "status":
                del self._items[idx]
                return True
        return False


@dataclass
class ConversationSessionRecord:
    """同一プロセス内での停止・再開時に会話状態を保持するレコード。"""

    user_id: str
    conversation_id: str
    transcript_state: ConversationTranscriptState
    soap_manager: SoapStateManager
    event_seq: int = 0
    active_generation: int = 0
    superseded: asyncio.Event = field(default_factory=asyncio.Event)
    soap_status: SoapLifecycleStatus = "idle"
    has_unapplied_transcript: bool = False
    pending_from_transcript_revision: int | None = None
    last_touched_monotonic: float = field(default_factory=time.monotonic)


class ConversationSessionRegistry:
    """(user_id, conversation_id) 単位の有界インメモリ会話レジストリ。"""

    def __init__(self, *, max_entries: int = 64, ttl_seconds: float = 3600.0) -> None:
        self._max_entries = max(1, max_entries)
        self._ttl_seconds = max(1.0, ttl_seconds)
        self._records: OrderedDict[tuple[str, str], ConversationSessionRecord] = OrderedDict()

    def get_or_create(
        self,
        *,
        user_id: str,
        conversation_id: str,
        now_monotonic: float | None = None,
    ) -> ConversationSessionRecord:
        now = now_monotonic if now_monotonic is not None else time.monotonic()
        self._evict_expired(now)
        key = (user_id, conversation_id)
        existing = self._records.get(key)
        if existing is not None:
            existing.last_touched_monotonic = now
            self._records.move_to_end(key)
            return existing

        record = ConversationSessionRecord(
            user_id=user_id,
            conversation_id=conversation_id,
            transcript_state=ConversationTranscriptState(conversation_id=conversation_id),
            soap_manager=SoapStateManager(conversation_id=conversation_id),
            last_touched_monotonic=now,
        )
        self._records[key] = record
        while len(self._records) > self._max_entries:
            _, evicted = self._records.popitem(last=False)
            evicted.transcript_state.clear_speaker_memory()
        return record

    def _evict_expired(self, now: float) -> None:
        expired_keys = [
            key
            for key, record in self._records.items()
            if now - record.last_touched_monotonic > self._ttl_seconds
        ]
        for key in expired_keys:
            evicted = self._records.pop(key, None)
            if evicted is not None:
                evicted.transcript_state.clear_speaker_memory()


_DEFAULT_REGISTRY = ConversationSessionRegistry()


def get_default_conversation_registry() -> ConversationSessionRegistry:
    """既定のインメモリ会話レジストリを返す。"""
    return _DEFAULT_REGISTRY


def _parse_deepgram_word_timings(alt0: dict[object, object]) -> tuple[DeepgramWordTiming, ...]:
    raw_words = alt0.get("words")
    if not isinstance(raw_words, list):
        return ()
    words: list[DeepgramWordTiming] = []
    for item in raw_words:
        if not isinstance(item, dict):
            continue
        word_text = str(item.get("punctuated_word") or item.get("word") or "").strip()
        raw_w_start = item.get("start")
        raw_w_end = item.get("end")
        raw_w_conf = item.get("confidence")
        if (
            not word_text
            or not isinstance(raw_w_start, int | float)
            or not isinstance(raw_w_end, int | float)
        ):
            continue
        w_start = max(0.0, float(raw_w_start))
        w_end = max(w_start, float(raw_w_end))
        if w_end <= w_start:
            continue
        w_conf = float(raw_w_conf) if isinstance(raw_w_conf, int | float) else 0.0
        words.append(
            DeepgramWordTiming(
                text=word_text,
                start_sec=w_start,
                end_sec=w_end,
                confidence=max(0.0, min(1.0, w_conf)),
            )
        )
    return tuple(words)


def _parse_deepgram_transcript_input(raw_text: str) -> DeepgramTranscriptInput | None:
    try:
        payload = json.loads(raw_text)
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("type") != "Results":
        return None

    channel_obj = payload.get("channel")
    if not isinstance(channel_obj, dict):
        return None
    alternatives = channel_obj.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives:
        return None
    alt0 = alternatives[0]
    if not isinstance(alt0, dict):
        return None
    text = str(alt0.get("transcript") or "").strip()
    if not text:
        return None

    raw_channel_idx = payload.get("channel_index")
    ch = 0
    if isinstance(raw_channel_idx, list) and raw_channel_idx:
        ch = 1 if raw_channel_idx[0] == 1 else 0

    raw_start = payload.get("start")
    raw_duration = payload.get("duration")
    raw_conf = alt0.get("confidence")
    start_sec = float(raw_start) if isinstance(raw_start, int | float) else 0.0
    duration_sec = float(raw_duration) if isinstance(raw_duration, int | float) else 0.0
    confidence = float(raw_conf) if isinstance(raw_conf, int | float) else 0.0
    return DeepgramTranscriptInput(
        channel_index=ch,
        text=text,
        is_final=bool(payload.get("is_final")),
        speech_final=bool(payload.get("speech_final")),
        start_sec=max(0.0, start_sec),
        end_sec=max(0.0, start_sec + max(0.0, duration_sec)),
        confidence=max(0.0, min(1.0, confidence)),
        words=_parse_deepgram_word_timings(alt0),
    )


@dataclass(frozen=True)
class SoapTimingOptions:
    """SOAP 集約・遅延制御・タイムアウト予算の設定値。"""

    debounce_seconds: float
    max_batch_wait_seconds: float
    min_interval_seconds: float
    llm_max_retries: int
    stt_final_timeout_seconds: float
    stop_llm_budget_seconds: float
    send_queue_maxsize: int
    protocol_version: int

    @classmethod
    def from_settings(cls) -> SoapTimingOptions:
        return cls(
            debounce_seconds=settings.soap_debounce_ms / 1000.0,
            max_batch_wait_seconds=settings.soap_max_batch_wait_seconds,
            min_interval_seconds=settings.soap_min_interval_seconds,
            llm_max_retries=settings.soap_llm_max_retries,
            stt_final_timeout_seconds=settings.soap_stt_final_timeout_seconds,
            stop_llm_budget_seconds=settings.soap_stop_llm_budget_seconds,
            send_queue_maxsize=settings.ws_send_queue_maxsize,
            protocol_version=settings.transcription_protocol_version,
        )


class _SoapSessionCoordinator:
    """1 WebSocket 接続内の発話正規化・非同期 LLM 実行・単一 writer 配信を調整する。"""

    def __init__(
        self,
        *,
        record: ConversationSessionRecord,
        stream_id: str,
        generation: int,
        queue: BoundedWsOutboundQueue,
        llm_client: SoapLlmClientProtocol | None,
        timing: SoapTimingOptions,
        audio_gate: AudioActivityGate | None = None,
        mono_mix: bool = False,
        speaker_client: SpeakerEmbeddingClientProtocol | None = None,
    ) -> None:
        self._record = record
        self._stream_id = stream_id
        self._generation = generation
        self._queue = queue
        self._llm_client = llm_client
        self._timing = timing
        self._audio_gate = audio_gate
        self._mono_mix = mono_mix
        self._speaker_client = speaker_client
        self._wakeup = asyncio.Event()
        self._pending_since: float | None = None
        self._has_speech_final_trigger = False
        self._last_llm_start: float = 0.0
        self._stopping = False
        self._llm_lock = asyncio.Lock()
        self._failed_extract_revision: int | None = None

    def is_current(self) -> bool:
        return self._record.active_generation == self._generation

    def _next_seq(self) -> int:
        self._record.event_seq += 1
        return self._record.event_seq

    def _event_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def enqueue_initial_snapshot(self) -> None:
        if not self.is_current():
            return
        soap_enabled = self._llm_client is not None
        status: SoapLifecycleStatus = (
            "disabled"
            if not soap_enabled
            else ("pending" if self._record.has_unapplied_transcript else self._record.soap_status)
        )
        if status == "updating":
            status = "pending" if self._record.has_unapplied_transcript else "idle"
        self._record.soap_status = status

        event = ConversationSnapshotEvent(
            protocol_version=self._timing.protocol_version,
            conversation_id=self._record.conversation_id,
            event_id=self._event_id(),
            sequence=self._next_seq(),
            segments=self._record.transcript_state.segments,
            soap=self._record.soap_manager.note,
            soap_status=status,
            has_unapplied_transcript=self._record.has_unapplied_transcript,
        )
        self._queue.enqueue(event.model_dump_json(), priority="high")

    def enqueue_soap_status(
        self,
        *,
        status: SoapLifecycleStatus,
        has_unapplied_transcript: bool,
        message: str | None = None,
    ) -> None:
        if not self.is_current():
            return
        self._record.soap_status = status
        self._record.has_unapplied_transcript = has_unapplied_transcript
        event = SoapStatusEvent(
            protocol_version=self._timing.protocol_version,
            conversation_id=self._record.conversation_id,
            event_id=self._event_id(),
            sequence=self._next_seq(),
            status=status,
            has_unapplied_transcript=has_unapplied_transcript,
            pending_from_transcript_revision=self._record.pending_from_transcript_revision,
            message=message,
        )
        self._queue.enqueue(event.model_dump_json(), priority="status")

    def handle_speaker_profile_message(self, raw_payload: dict[str, object]) -> None:
        """クライアントから届いた端末ローカル薬剤師声紋を会話の一時メモリへ反映する。"""
        if not self.is_current():
            return
        try:
            frame = SpeakerProfileFrame.model_validate(raw_payload)
        except ValidationError:
            ack = SpeakerProfileAckEvent(
                accepted=False,
                model_id=str(raw_payload.get("model_id") or ""),
                reason="声紋フレームの形式が不正です。",
            )
            self._queue.enqueue(ack.model_dump_json(), priority="status")
            return

        accepted, reason = self._record.transcript_state.set_pharmacist_profile(
            model_id=frame.model_id,
            embedding=frame.embedding,
        )
        ack = SpeakerProfileAckEvent(
            accepted=accepted,
            model_id=frame.model_id,
            reason=reason,
        )
        self._queue.enqueue(ack.model_dump_json(), priority="status")

    def handle_segment_speaker_override(self, raw_payload: dict[str, object]) -> None:
        """クライアント UI からの手動話者訂正を反映し、SOAP 整合・再抽出を起動する。"""
        if not self.is_current():
            return
        try:
            frame = SegmentSpeakerOverrideFrame.model_validate(raw_payload)
        except ValidationError:
            return

        updated = self._record.transcript_state.override_segment_speaker(
            stream_id=frame.stream_id,
            segment_id=frame.segment_id,
            speaker_role=frame.speaker_role,
        )
        if updated is None:
            return

        event = TranscriptUpdatedEvent(
            protocol_version=self._timing.protocol_version,
            conversation_id=self._record.conversation_id,
            event_id=self._event_id(),
            sequence=self._next_seq(),
            segment=updated,
            removed=False,
        )
        self._queue.enqueue(event.model_dump_json(), priority="high")
        self._reconcile_soap_with_transcript()

        if self._llm_client is not None and updated.speaker_role in {"pharmacist", "patient"}:
            if self._pending_since is None:
                self._pending_since = time.monotonic()
            if self._record.pending_from_transcript_revision is None:
                self._record.pending_from_transcript_revision = updated.transcript_revision
            self._has_speech_final_trigger = True
            self._record.has_unapplied_transcript = True
            if self._record.soap_status not in {"updating", "pending"}:
                self.enqueue_soap_status(status="pending", has_unapplied_transcript=True)
            self._wakeup.set()

    def _parse_and_resolve_gate(self, raw_text: str) -> DeepgramTranscriptInput | None:
        parsed = _parse_deepgram_transcript_input(raw_text)
        if parsed is None:
            return None
        if self._audio_gate is not None:
            resolved = self._audio_gate.resolve_stt_interval(parsed.start_sec, parsed.end_sec)
            if resolved is not None:
                next_channel = (
                    resolved.dominant_channel
                    if (self._mono_mix and resolved.dominant_channel is not None)
                    else parsed.channel_index
                )
                offset = resolved.real_start_sec - parsed.start_sec
                shifted_words = tuple(
                    DeepgramWordTiming(
                        text=w.text,
                        start_sec=max(
                            resolved.real_start_sec,
                            min(resolved.real_end_sec, w.start_sec + offset),
                        ),
                        end_sec=max(
                            max(
                                resolved.real_start_sec,
                                min(resolved.real_end_sec, w.start_sec + offset),
                            ),
                            min(resolved.real_end_sec, w.end_sec + offset),
                        ),
                        confidence=w.confidence,
                    )
                    for w in parsed.words
                )
                return DeepgramTranscriptInput(
                    channel_index=next_channel,
                    text=parsed.text,
                    is_final=parsed.is_final,
                    speech_final=parsed.speech_final,
                    start_sec=resolved.real_start_sec,
                    end_sec=resolved.real_end_sec,
                    confidence=parsed.confidence,
                    words=shifted_words,
                )
        return parsed

    def _extract_embedding_for_interval(
        self,
        *,
        channel_index: int,
        start_sec: float,
        end_sec: float,
    ) -> list[float] | None:
        if self._speaker_client is None or self._mono_mix:
            return None
        sliced = self._record.transcript_state.slice_pcm16(start_sec, end_sec)
        if sliced is None:
            return None
        pcm_bytes, channels, sample_rate = sliced
        channel_idx = 1 if channel_index == 1 and channels == 2 else 0
        selected = select_speaker_audio(
            pcm_bytes, sample_rate=sample_rate, channels=channels, channel_index=channel_idx
        )
        if (
            selected.voiced_sec < settings.speaker_min_embed_seconds
            or selected.clipped_fraction >= 0.01
        ):
            return None
        try:
            return self._speaker_client.extract_embedding_from_pcm16(
                selected.pcm16_bytes,
                sample_rate=sample_rate,
                channels=1,
                channel_index=0,
            )
        except SpeakerEmbeddingClientError:
            return None

    def _extract_embedding_for_event(self, parsed: DeepgramTranscriptInput) -> list[float] | None:
        if self._speaker_client is None or self._mono_mix:
            return None
        if not self._record.transcript_state.needs_speaker_embedding(parsed):
            return None
        start_sec, end_sec = self._record.transcript_state.speaker_embedding_interval(parsed)
        return self._extract_embedding_for_interval(
            channel_index=parsed.channel_index,
            start_sec=start_sec,
            end_sec=end_sec,
        )

    def _resolve_events_for_final(
        self, parsed: DeepgramTranscriptInput
    ) -> list[tuple[DeepgramTranscriptInput, list[float] | None]]:
        """確定発話を必要に応じ words[] の話者交代境界で分割し、各区間の埋め込みと共に返す。"""
        if self._speaker_client is None or self._mono_mix:
            return [(parsed, None)]

        if self._record.transcript_state.needs_turn_split_probe(parsed):
            clauses = build_word_clause_candidates(
                parsed.words,
                min_chunk_sec=settings.speaker_min_embed_seconds,
            )
            if len(clauses) >= 2:
                probed: list[
                    tuple[tuple[DeepgramWordTiming, ...], SpeakerRole, list[float] | None]
                ] = []
                for clause_words in clauses:
                    c_start = clause_words[0].start_sec
                    c_end = clause_words[-1].end_sec
                    emb = self._extract_embedding_for_interval(
                        channel_index=parsed.channel_index,
                        start_sec=c_start,
                        end_sec=c_end,
                    )
                    role = self._record.transcript_state.classify_probe_segment(
                        channel_index=parsed.channel_index,
                        start_sec=c_start,
                        end_sec=c_end,
                        segment_embedding=emb,
                    )
                    probed.append((clause_words, role, emb))

                known_roles = {role for _, role, _ in probed if role in {"pharmacist", "patient"}}
                if len(known_roles) >= 2:
                    merged: list[
                        tuple[list[DeepgramWordTiming], SpeakerRole, list[float] | None]
                    ] = []
                    for clause_words, role, emb in probed:
                        if merged and merged[-1][1] == role:
                            merged[-1][0].extend(clause_words)
                            merged[-1] = (merged[-1][0], role, None)
                        else:
                            merged.append((list(clause_words), role, emb))

                    resolved_turns: list[tuple[DeepgramTranscriptInput, list[float] | None]] = []
                    last_idx = len(merged) - 1
                    for idx, (turn_words, _, cached_emb) in enumerate(merged):
                        t_start = turn_words[0].start_sec
                        t_end = turn_words[-1].end_sec
                        t_conf = sum(w.confidence for w in turn_words) / len(turn_words)
                        sub_emb = (
                            cached_emb
                            if cached_emb is not None
                            else self._extract_embedding_for_interval(
                                channel_index=parsed.channel_index,
                                start_sec=t_start,
                                end_sec=t_end,
                            )
                        )
                        sub_input = DeepgramTranscriptInput(
                            channel_index=parsed.channel_index,
                            text=join_deepgram_words(turn_words),
                            is_final=True,
                            speech_final=parsed.speech_final if idx == last_idx else False,
                            start_sec=t_start,
                            end_sec=t_end,
                            confidence=t_conf if t_conf > 0 else parsed.confidence,
                            words=tuple(turn_words),
                        )
                        resolved_turns.append((sub_input, sub_emb))
                    return resolved_turns

        emb = self._extract_embedding_for_event(parsed)
        return [(parsed, emb)]

    async def handle_deepgram_message_async(self, raw_text: str) -> None:
        """イベントループを塞がずに話者埋め込みを抽出し、Deepgram メッセージを反映する。"""
        if not self.is_current():
            return
        parsed = self._parse_and_resolve_gate(raw_text)
        if parsed is None:
            return
        if self._speaker_client is not None and not self._mono_mix and parsed.is_final:
            resolved_events = await asyncio.to_thread(self._resolve_events_for_final, parsed)
            for sub_input, sub_emb in resolved_events:
                self.handle_deepgram_message(
                    raw_text,
                    precomputed_embedding=sub_emb,
                    resolved_input=sub_input,
                )
            return
        self.handle_deepgram_message(
            raw_text,
            precomputed_embedding=None,
            resolved_input=parsed,
        )

    def _reconcile_soap_with_transcript(self) -> None:
        """後からの話者訂正・重複統合で既反映 SOAP の根拠が無効化された場合に自動補正する。"""
        current_lookup = {
            (seg.stream_id, seg.segment_id): seg
            for seg in self._record.transcript_state.finalized_segments
        }
        outcome = self._record.soap_manager.reconcile_transcript_segments(current_lookup)
        if outcome.applied_operations > 0 or outcome.retracted_item_ids:
            updated_event = SoapUpdatedEvent(
                protocol_version=self._timing.protocol_version,
                conversation_id=self._record.conversation_id,
                event_id=self._event_id(),
                sequence=self._next_seq(),
                soap=outcome.soap,
                changed_item_ids=outcome.changed_item_ids,
                retracted_item_ids=outcome.retracted_item_ids,
            )
            self._queue.enqueue(updated_event.model_dump_json(), priority="high")

    def handle_deepgram_message(
        self,
        raw_text: str,
        *,
        precomputed_embedding: list[float] | None = None,
        resolved_input: DeepgramTranscriptInput | None = None,
    ) -> None:
        if not self.is_current():
            return
        parsed = (
            resolved_input if resolved_input is not None else self._parse_and_resolve_gate(raw_text)
        )
        if parsed is None:
            return
        outcome = self._record.transcript_state.apply_deepgram_event(
            parsed,
            stream_id=self._stream_id,
            single_stream_diarized=self._mono_mix,
            segment_embedding=precomputed_embedding,
        )
        if outcome.segment is not None:
            event = TranscriptUpdatedEvent(
                protocol_version=self._timing.protocol_version,
                conversation_id=self._record.conversation_id,
                event_id=self._event_id(),
                sequence=self._next_seq(),
                segment=outcome.segment,
                removed=outcome.removed,
            )
            priority: _QueuePriority = (
                "interim"
                if (outcome.segment.status == "interim" and not outcome.removed)
                else "high"
            )
            self._queue.enqueue(event.model_dump_json(), priority=priority)

        for refined_seg in outcome.refined_segments:
            refined_event = TranscriptUpdatedEvent(
                protocol_version=self._timing.protocol_version,
                conversation_id=self._record.conversation_id,
                event_id=self._event_id(),
                sequence=self._next_seq(),
                segment=refined_seg,
                removed=False,
            )
            self._queue.enqueue(refined_event.model_dump_json(), priority="high")

        for removed_seg in outcome.removed_segments:
            removed_event = TranscriptUpdatedEvent(
                protocol_version=self._timing.protocol_version,
                conversation_id=self._record.conversation_id,
                event_id=self._event_id(),
                sequence=self._next_seq(),
                segment=removed_seg,
                removed=True,
            )
            self._queue.enqueue(removed_event.model_dump_json(), priority="high")

        if (
            outcome.refined_segments
            or outcome.removed_segments
            or (outcome.removed and outcome.suppressed_crosstalk)
        ):
            self._reconcile_soap_with_transcript()

        if (outcome.is_new_final or outcome.refined_segments) and self._llm_client is not None:
            now = time.monotonic()
            if self._pending_since is None:
                self._pending_since = now
            if self._record.pending_from_transcript_revision is None:
                latest_rev = (
                    max(s.transcript_revision for s in outcome.refined_segments)
                    if outcome.refined_segments
                    else (outcome.segment.transcript_revision if outcome.segment is not None else 0)
                )
                if latest_rev > 0:
                    self._record.pending_from_transcript_revision = latest_rev
            if parsed.speech_final:
                self._has_speech_final_trigger = True
            self._record.has_unapplied_transcript = True
            if self._record.soap_status not in {"updating", "pending"}:
                self.enqueue_soap_status(status="pending", has_unapplied_transcript=True)
            self._wakeup.set()

    async def llm_worker_loop(self) -> None:
        """Deepgram 受信ループをブロックせずに確定発話を集約して SOAP を更新する。"""
        if self._llm_client is None:
            return

        while not self._stopping and self.is_current():
            if not self._has_extractable_finals():
                self._wakeup.clear()
                if self._stopping:
                    return
                if not self._has_extractable_finals():
                    await self._wakeup.wait()
                    continue

            await self._wait_debounce_and_interval()
            if self._stopping:
                return
            await self._run_extract_step(retries=self._timing.llm_max_retries)

    def request_stop_background_llm(self) -> None:
        self._stopping = True
        self._wakeup.set()

    async def finalize_on_stop(
        self,
        *,
        reason: Literal["stopped", "session_limit", "auth_expired", "upstream_closed"],
        completion_message: str | None = None,
        budget_seconds: float | None = None,
    ) -> ConversationCompletedEvent:
        """最終発話まで同期した後、15秒予算内で P 更新と A 最終推測を行う。"""
        if not self.is_current():
            raise asyncio.CancelledError
        self._stopping = True
        self._wakeup.set()

        if self._llm_client is not None:
            budget = (
                budget_seconds
                if budget_seconds is not None
                else self._timing.stop_llm_budget_seconds
            )
            started = time.monotonic()
            sync_ok = True

            if self._has_unprocessed_finals():
                if budget <= 0.05:
                    sync_ok = False
                    self.enqueue_soap_status(
                        status="error",
                        has_unapplied_transcript=True,
                        message="停止時の SOAP 最終同期がタイムアウトしました。",
                    )
                else:
                    try:
                        sync_ok = await asyncio.wait_for(
                            self._run_extract_step(retries=0),
                            timeout=budget,
                        )
                    except TimeoutError:
                        sync_ok = False
                        self.enqueue_soap_status(
                            status="error",
                            has_unapplied_transcript=True,
                            message="停止時の SOAP 最終同期がタイムアウトしました。",
                        )

            remaining_budget = budget - (time.monotonic() - started)
            # P の最終同期に失敗したときは古い P で推測を確定せず、A 最終更新を保留する
            if (
                sync_ok
                and not self._has_unprocessed_finals()
                and self._record.soap_manager.has_plan_items
                and remaining_budget > 0.05
            ):
                try:
                    await asyncio.wait_for(
                        self._run_finalize_a_step(),
                        timeout=remaining_budget,
                    )
                except TimeoutError:
                    self.enqueue_soap_status(
                        status="error",
                        has_unapplied_transcript=True,
                        message="A アセスメント案の最終更新がタイムアウトしました。",
                    )

        if not self.is_current():
            raise asyncio.CancelledError
        completed = ConversationCompletedEvent(
            protocol_version=self._timing.protocol_version,
            conversation_id=self._record.conversation_id,
            event_id=self._event_id(),
            sequence=self._next_seq(),
            reason=reason,
            final_transcript_revision=self._record.transcript_state.transcript_revision,
            soap_revision=self._record.soap_manager.note.revision,
            has_unapplied_transcript=(
                self._record.has_unapplied_transcript or self._has_unprocessed_finals()
            ),
            message=completion_message,
        )
        self._queue.enqueue(completed.model_dump_json(), priority="high")
        return completed

    def _has_unprocessed_finals(self) -> bool:
        processed = self._record.soap_manager.note.processed_transcript_revision
        return any(
            seg.transcript_revision > processed
            for seg in self._record.transcript_state.finalized_segments
        )

    def _has_extractable_finals(self) -> bool:
        """失敗した入力版は新しい確定発話が届くまで自動再処理しない。"""
        return self._has_unprocessed_finals() and any(
            seg.transcript_revision > (self._failed_extract_revision or 0)
            for seg in self._record.transcript_state.finalized_segments
        )

    async def _wait_debounce_and_interval(self) -> None:
        while not self._stopping:
            now = time.monotonic()
            since_last_llm = now - self._last_llm_start if self._last_llm_start > 0 else 999.0
            interval_wait = max(0.0, self._timing.min_interval_seconds - since_last_llm)

            pending_since = self._pending_since or now
            batch_elapsed = now - pending_since
            batch_remaining = max(0.0, self._timing.max_batch_wait_seconds - batch_elapsed)

            if self._has_speech_final_trigger or batch_remaining <= 0.0:
                wait_for = interval_wait
            else:
                wait_for = max(interval_wait, min(self._timing.debounce_seconds, batch_remaining))

            if wait_for <= 0.001:
                return

            self._wakeup.clear()
            with suppress(TimeoutError):
                await asyncio.wait_for(self._wakeup.wait(), timeout=wait_for)
            if self._has_speech_final_trigger or (
                self._pending_since is not None
                and time.monotonic() - self._pending_since >= self._timing.max_batch_wait_seconds
            ):
                still_interval = (
                    max(
                        0.0,
                        self._timing.min_interval_seconds
                        - (time.monotonic() - self._last_llm_start),
                    )
                    if self._last_llm_start > 0
                    else 0.0
                )
                if still_interval > 0.001 and not self._stopping:
                    await asyncio.sleep(still_interval)
                return

    async def _run_extract_step(self, *, retries: int) -> bool:
        if self._llm_client is None:
            return False

        async with self._llm_lock:
            if self._record.active_generation != self._generation:
                return False

            processed = self._record.soap_manager.note.processed_transcript_revision
            all_finals = self._record.transcript_state.finalized_segments
            new_segments = [seg for seg in all_finals if seg.transcript_revision > processed]
            if not new_segments:
                self._pending_since = None
                self._has_speech_final_trigger = False
                return True

            target_rev = max(seg.transcript_revision for seg in new_segments)
            if (
                self._failed_extract_revision is not None
                and target_rev <= self._failed_extract_revision
            ):
                return False
            snapshot_lookup = {(seg.stream_id, seg.segment_id): seg for seg in all_finals}
            self._pending_since = None
            self._has_speech_final_trigger = False
            self._last_llm_start = time.monotonic()
            self.enqueue_soap_status(status="updating", has_unapplied_transcript=True)

            last_exc: SoapLlmClientError | None = None
            for attempt in range(retries + 1):
                try:
                    raw = await self._llm_client.extract_spoa(
                        self._record.soap_manager.build_extract_payload(
                            new_segments=new_segments,
                            all_final_segments=list(snapshot_lookup.values()),
                        )
                    )
                    if self._record.active_generation != self._generation:
                        return False
                    current_lookup = {
                        (seg.stream_id, seg.segment_id): seg
                        for seg in self._record.transcript_state.finalized_segments
                    }
                    outcome = self._record.soap_manager.apply_extract_spoa_raw(
                        raw_result=raw,
                        segments_lookup=current_lookup,
                        processed_transcript_revision=target_rev,
                    )
                    self._record.last_touched_monotonic = time.monotonic()
                    if outcome.applied_operations > 0 or outcome.retracted_item_ids:
                        updated_event = SoapUpdatedEvent(
                            protocol_version=self._timing.protocol_version,
                            conversation_id=self._record.conversation_id,
                            event_id=self._event_id(),
                            sequence=self._next_seq(),
                            soap=outcome.soap,
                            changed_item_ids=outcome.changed_item_ids,
                            retracted_item_ids=outcome.retracted_item_ids,
                        )
                        self._queue.enqueue(updated_event.model_dump_json(), priority="high")

                    still_pending = self._has_unprocessed_finals()
                    if still_pending:
                        self._record.pending_from_transcript_revision = target_rev + 1
                        self.enqueue_soap_status(status="pending", has_unapplied_transcript=True)
                    else:
                        self._record.pending_from_transcript_revision = None
                        self.enqueue_soap_status(
                            status="ready",
                            has_unapplied_transcript=self._record.soap_manager.has_stale_plan_inference(),
                        )
                    return True
                except SoapLlmClientError as exc:
                    if not self.is_current():
                        return False
                    last_exc = exc
                    non_retryable = exc.code in {"LLM_INPUT_TOO_LARGE", "LLM_NOT_CONFIGURED"}
                    if non_retryable or attempt >= retries or self._stopping:
                        break

            self._failed_extract_revision = target_rev
            message = str(last_exc) if last_exc is not None else "SOAP の更新に失敗しました。"
            self.enqueue_soap_status(
                status="error",
                has_unapplied_transcript=True,
                message=message,
            )
            return False

    async def _run_finalize_a_step(self) -> bool:
        if self._llm_client is None or not self._record.soap_manager.has_plan_items:
            return True

        async with self._llm_lock:
            if self._record.active_generation != self._generation:
                return False
            self.enqueue_soap_status(
                status="updating",
                has_unapplied_transcript=self._record.has_unapplied_transcript,
            )
            try:
                manager = self._record.soap_manager
                expected_plan_items = {
                    item.item_id: item.item_revision for item in manager.note.sections.P.items
                }
                raw = await self._llm_client.finalize_a_from_p(manager.build_finalize_a_payload())
                if not self.is_current():
                    return False
                current_lookup = {
                    (seg.stream_id, seg.segment_id): seg
                    for seg in self._record.transcript_state.finalized_segments
                }
                outcome = manager.apply_finalize_a_raw(
                    raw_result=raw,
                    segments_lookup=current_lookup,
                    expected_plan_items=expected_plan_items,
                )
                self._record.last_touched_monotonic = time.monotonic()
                if outcome.stale_discarded:
                    self.enqueue_soap_status(
                        status="pending",
                        has_unapplied_transcript=True,
                        message="P の更新を検知したため古い A 推測結果を破棄しました。",
                    )
                    return False

                if outcome.applied_operations > 0:
                    updated_event = SoapUpdatedEvent(
                        protocol_version=self._timing.protocol_version,
                        conversation_id=self._record.conversation_id,
                        event_id=self._event_id(),
                        sequence=self._next_seq(),
                        soap=outcome.soap,
                        changed_item_ids=outcome.changed_item_ids,
                        retracted_item_ids=outcome.retracted_item_ids,
                    )
                    self._queue.enqueue(updated_event.model_dump_json(), priority="high")

                self.enqueue_soap_status(
                    status="ready",
                    has_unapplied_transcript=self._record.soap_manager.has_stale_plan_inference(),
                )
                return True
            except SoapLlmClientError as exc:
                self.enqueue_soap_status(
                    status="error",
                    has_unapplied_transcript=True,
                    message=str(exc),
                )
                return False


async def relay_soap_conversation_stream(
    *,
    client_ws: StreamClientWebSocketProtocol,
    deepgram_ws: DeepgramStreamProtocol,
    config: TranscriptionStreamConfig,
    user_id: str,
    user_expires_at: int,
    remaining_seconds: float,
    on_close: Callable[[int, str], Awaitable[None]] | None,
    llm_client: SoapLlmClientProtocol | None = None,
    use_default_llm: bool = True,
    registry: ConversationSessionRegistry | None = None,
    timing: SoapTimingOptions | None = None,
    now_fn: Callable[[], float] | None = None,
    mono_mix: bool | None = None,
    audio_gate: AudioActivityGate | None = None,
    speaker_client: SpeakerEmbeddingClientProtocol | None = None,
    use_default_speaker_client: bool = True,
) -> None:
    """会話状態・単一 writer・Deepgram 中継・非同期 SOAP 生成を統合して実行する。"""
    resolved_timing = timing or SoapTimingOptions.from_settings()
    resolved_registry = registry or get_default_conversation_registry()
    resolved_conv_id = (config.conversation_id or "").strip() or f"conv-{uuid.uuid4().hex[:12]}"
    resolved_mono_mix = (
        mono_mix
        if mono_mix is not None
        else (config.channels == 2 and settings.stt_mono_mix_enabled)
    )
    resolved_vad_enabled = config.channels == 2 and settings.stt_vad_enabled
    active_gate: AudioActivityGate | None = audio_gate
    if active_gate is None and (resolved_mono_mix or resolved_vad_enabled):
        active_gate = AudioActivityGate(
            AudioGateConfig(
                sample_rate=config.sample_rate,
                input_channels=config.channels,
                output_channels=1 if resolved_mono_mix else config.channels,
                vad_enabled=resolved_vad_enabled,
                rms_threshold=settings.stt_vad_rms_threshold,
                preroll_ms=settings.stt_vad_preroll_ms,
                hangover_ms=settings.stt_vad_hangover_ms,
            )
        )
    elif active_gate is not None:
        active_gate.reset()

    effective_llm = (
        llm_client
        if llm_client is not None
        else (get_default_soap_llm_client() if (use_default_llm and config.channels == 2) else None)
    )
    effective_speaker_client = (
        speaker_client
        if speaker_client is not None
        else (
            get_default_speaker_embedding_client(require_available=False)
            if (use_default_speaker_client and config.channels == 2 and not resolved_mono_mix)
            else None
        )
    )

    record = resolved_registry.get_or_create(
        user_id=user_id,
        conversation_id=resolved_conv_id,
    )
    record.active_generation += 1
    generation = record.active_generation
    record.superseded.set()
    record.superseded = asyncio.Event()
    superseded = record.superseded
    stream_id = record.transcript_state.start_stream()

    queue = BoundedWsOutboundQueue(maxsize=resolved_timing.send_queue_maxsize)
    coordinator = _SoapSessionCoordinator(
        record=record,
        stream_id=stream_id,
        generation=generation,
        queue=queue,
        llm_client=effective_llm,
        timing=resolved_timing,
        audio_gate=active_gate,
        mono_mix=resolved_mono_mix,
        speaker_client=effective_speaker_client,
    )

    async def _send_error_and_close(
        *, close_code: int, error_code: str, message: str, reason: str
    ) -> None:
        err = TranscriptionErrorEvent(code=error_code, message=message)
        with suppress(Exception):
            await client_ws.send_text(err.model_dump_json())
        if on_close is not None:
            await on_close(close_code, reason)

    async def _forward_client() -> bool:
        last_tx_monotonic = time.monotonic()
        keepalive_interval = settings.stt_keepalive_interval_seconds
        while True:
            payload = await client_ws.receive_message()
            if not coordinator.is_current():
                return False
            if payload is None:
                with suppress(Exception):
                    await deepgram_ws.send('{"type": "CloseStream"}')
                return False
            if isinstance(payload, bytes):
                if active_gate is not None:
                    gate_result = active_gate.process_pcm16(payload)
                    if not resolved_mono_mix:
                        record.transcript_state.append_pcm16(
                            payload,
                            channels=config.channels,
                            sample_rate=config.sample_rate,
                        )
                    if gate_result.emit_pcm16:
                        await deepgram_ws.send(gate_result.emit_pcm16)
                        last_tx_monotonic = time.monotonic()
                    elif time.monotonic() - last_tx_monotonic >= keepalive_interval:
                        await deepgram_ws.send('{"type": "KeepAlive"}')
                        last_tx_monotonic = time.monotonic()
                else:
                    record.transcript_state.append_pcm16(
                        payload,
                        channels=config.channels,
                        sample_rate=config.sample_rate,
                    )
                    await deepgram_ws.send(payload)
                continue
            try:
                control = json.loads(payload)
            except ValueError:
                await deepgram_ws.send(payload)
                continue
            if isinstance(control, dict):
                msg_type = control.get("type")
                if msg_type == "Auth":
                    continue
                if msg_type == "SpeakerProfile":
                    coordinator.handle_speaker_profile_message(control)
                    continue
                if msg_type == "UpdateSegmentSpeaker":
                    coordinator.handle_segment_speaker_override(control)
                    continue
                if msg_type == "CloseStream":
                    await deepgram_ws.send(payload)
                    return True
            await deepgram_ws.send(payload)

    async def _forward_deepgram() -> None:
        while True:
            try:
                message = await deepgram_ws.recv()
            except EOFError:
                return
            except Exception as exc:
                raise DeepgramClientError("文字起こしストリームの受信に失敗しました。") from exc
            text = (
                message.decode("utf-8", errors="ignore") if isinstance(message, bytes) else message
            )
            await coordinator.handle_deepgram_message_async(text)

    writer_task = asyncio.create_task(queue.drain_to(client_ws.send_text))
    llm_task = asyncio.create_task(coordinator.llm_worker_loop())
    client_task = asyncio.create_task(_forward_client())
    deepgram_task = asyncio.create_task(_forward_deepgram())
    deadline_task = asyncio.create_task(asyncio.sleep(remaining_seconds))
    superseded_task = asyncio.create_task(superseded.wait())

    coordinator.enqueue_initial_snapshot()
    get_now = now_fn or time.time
    client_disconnected = False

    async def _finish_stop_llm(
        *,
        reason: Literal["stopped", "session_limit", "auth_expired", "upstream_closed"],
        completion_message: str | None = None,
    ) -> None:
        stop_started = time.monotonic()
        coordinator.request_stop_background_llm()
        if not llm_task.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(llm_task),
                    timeout=resolved_timing.stop_llm_budget_seconds,
                )
            except TimeoutError:
                llm_task.cancel()
                await asyncio.gather(llm_task, return_exceptions=True)
                coordinator.enqueue_soap_status(
                    status="error",
                    has_unapplied_transcript=True,
                    message="停止時の SOAP 最終同期がタイムアウトしました。",
                )
                remaining_budget = 0.0
            else:
                remaining_budget = max(
                    0.0,
                    resolved_timing.stop_llm_budget_seconds - (time.monotonic() - stop_started),
                )
        else:
            remaining_budget = resolved_timing.stop_llm_budget_seconds

        await coordinator.finalize_on_stop(
            reason=reason,
            completion_message=completion_message,
            budget_seconds=remaining_budget,
        )

    try:
        done, _ = await asyncio.wait(
            {client_task, deepgram_task, deadline_task, writer_task, superseded_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        if superseded_task in done or not coordinator.is_current():
            if on_close is not None:
                await on_close(1000, "superseded")
            return

        if writer_task in done:
            # 送信キュー溢れ等の送信系エラーを表面化させる
            writer_task.result()

        if deadline_task in done:
            client_task.cancel()
            await asyncio.gather(client_task, return_exceptions=True)
            with suppress(Exception):
                await deepgram_ws.send('{"type": "CloseStream"}')
            try:
                await asyncio.wait_for(
                    asyncio.shield(deepgram_task),
                    timeout=resolved_timing.stt_final_timeout_seconds,
                )
            except TimeoutError as exc:
                raise DeepgramClientError(
                    "文字起こしの最終結果の待機がタイムアウトしました。"
                ) from exc

            expired_by_jwt = get_now() >= user_expires_at
            completion_msg = (
                "認証の有効期限に達したため文字起こしを終了しました。"
                if expired_by_jwt
                else "文字起こしセッションの上限時間に達したため終了しました。"
            )
            await _finish_stop_llm(
                reason="auth_expired" if expired_by_jwt else "session_limit",
                completion_message=completion_msg,
            )
            queue.close()
            await asyncio.gather(writer_task, return_exceptions=True)
            await _send_error_and_close(
                close_code=1008 if expired_by_jwt else 1000,
                error_code="AUTH_EXPIRED" if expired_by_jwt else "SESSION_LIMIT_REACHED",
                message=completion_msg,
                reason="session expired",
            )
            return

        deadline_task.cancel()
        await asyncio.gather(deadline_task, return_exceptions=True)

        if client_task in done:
            graceful = client_task.result()
            client_disconnected = not graceful
            if graceful:
                try:
                    await asyncio.wait_for(
                        asyncio.shield(deepgram_task),
                        timeout=resolved_timing.stt_final_timeout_seconds,
                    )
                except TimeoutError as exc:
                    raise DeepgramClientError(
                        "文字起こしの最終結果の待機がタイムアウトしました。"
                    ) from exc

                await _finish_stop_llm(reason="stopped")
            else:
                coordinator.request_stop_background_llm()
        else:
            deepgram_task.result()
            await _finish_stop_llm(reason="upstream_closed")

        queue.close()
        await writer_task
        if not client_disconnected and on_close is not None:
            await on_close(1000, "stream complete")
    except OutboundQueueOverflowError as exc:
        coordinator.request_stop_background_llm()
        queue.close()
        await _send_error_and_close(
            close_code=1011,
            error_code="QUEUE_OVERFLOW",
            message=str(exc),
            reason="queue overflow",
        )
    finally:
        coordinator.request_stop_background_llm()
        queue.close()
        record.transcript_state.clear_pcm_buffer()
        for task in (
            client_task,
            deepgram_task,
            deadline_task,
            llm_task,
            writer_task,
            superseded_task,
        ):
            if not task.done():
                task.cancel()
        await asyncio.gather(
            client_task,
            deepgram_task,
            deadline_task,
            llm_task,
            writer_task,
            superseded_task,
            return_exceptions=True,
        )
