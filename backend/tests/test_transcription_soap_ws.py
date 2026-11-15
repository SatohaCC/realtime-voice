import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any

import pytest

from app.clients.deepgram_client import DeepgramStreamProtocol
from app.clients.soap_llm_client import SoapLlmClientError
from app.clients.supabase_auth_client import AuthClientError
from app.schemas.auth import AuthenticatedUser
from app.schemas.transcription import TranscriptionStreamConfig
from app.services.soap_stream_service import (
    BoundedWsOutboundQueue,
    ConversationSessionRegistry,
    SoapTimingOptions,
    _SoapSessionCoordinator,
)
from app.services.transcription_service import relay_deepgram_stream
from tests.fake_soap_llm_client import FakeSoapLlmClient


class _StubAuthClient:
    def __init__(self, *, should_fail: bool = False) -> None:
        self._should_fail = should_fail

    async def verify_access_token(self, token: str) -> AuthenticatedUser:
        if self._should_fail or token != "valid-token":
            raise AuthClientError("invalid", code="AUTH_INVALID_TOKEN", status_code=401)
        return AuthenticatedUser(
            user_id="user-1",
            email="pharm@example.com",
            role="authenticated",
            expires_at=2_000_000_000,
        )


class _StubClientWs:
    def __init__(self, incoming: list[bytes | str | None]) -> None:
        self._incoming = asyncio.Queue[bytes | str | None]()
        for item in incoming:
            self._incoming.put_nowait(item)
        self.sent_texts: list[str] = []

    async def receive_message(self) -> bytes | str | None:
        return await self._incoming.get()

    async def send_text(self, text: str) -> None:
        self.sent_texts.append(text)

    def parsed_events(self) -> list[dict[str, Any]]:
        return [json.loads(item) for item in self.sent_texts]


class _StubDeepgramStream:
    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.sent_payloads: list[bytes | str] = []
        self._closed_event = asyncio.Event()

    async def send(self, payload: bytes | str) -> None:
        self.sent_payloads.append(payload)
        if isinstance(payload, str) and '"CloseStream"' in payload:
            self._closed_event.set()

    async def recv(self) -> bytes | str:
        if self._responses:
            return self._responses.pop(0)
        await self._closed_event.wait()
        raise EOFError

    async def close(self) -> None:
        self._closed_event.set()


class _StubDeepgramClient:
    def __init__(self, responses: list[str]) -> None:
        self.connect_calls = 0
        self._stream = _StubDeepgramStream(responses)

    @asynccontextmanager
    async def connect_listen_stream(
        self,
        *,
        channels: int = 2,
        language: str = "ja",
        sample_rate: int = 16000,
        endpointing_ms: int = 300,
    ) -> AsyncIterator[DeepgramStreamProtocol]:
        self.connect_calls += 1
        yield self._stream


class _CountingLlmClient(FakeSoapLlmClient):
    def __init__(self, *, delay_seconds: float = 0.0, fail_extract: bool = False) -> None:
        super().__init__()
        self.extract_calls = 0
        self.finalize_calls = 0
        self._delay_seconds = delay_seconds
        self._fail_extract = fail_extract

    async def extract_spoa(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.extract_calls += 1
        if self._delay_seconds > 0:
            await asyncio.sleep(self._delay_seconds)
        if self._fail_extract:
            raise SoapLlmClientError("LLM unavailable", code="LLM_UNAVAILABLE")
        return await super().extract_spoa(payload)

    async def finalize_a_from_p(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.finalize_calls += 1
        return await super().finalize_a_from_p(payload)


def _dg_result(
    *,
    channel: int,
    text: str,
    is_final: bool,
    speech_final: bool,
    start: float,
    duration: float = 1.0,
    confidence: float = 0.95,
) -> str:
    return json.dumps(
        {
            "type": "Results",
            "channel_index": [channel, 2],
            "start": start,
            "duration": duration,
            "is_final": is_final,
            "speech_final": speech_final,
            "channel": {"alternatives": [{"transcript": text, "confidence": confidence}]},
        },
        ensure_ascii=False,
    )


def _fast_timing() -> SoapTimingOptions:
    return SoapTimingOptions(
        debounce_seconds=0.01,
        max_batch_wait_seconds=0.02,
        min_interval_seconds=0.01,
        llm_max_retries=0,
        stt_final_timeout_seconds=1.0,
        stop_llm_budget_seconds=1.0,
        send_queue_maxsize=64,
        protocol_version=1,
    )


def _coordinator(llm: FakeSoapLlmClient) -> tuple[Any, _SoapSessionCoordinator]:
    record = ConversationSessionRegistry().get_or_create(user_id="u1", conversation_id="c1")
    record.active_generation = 1
    stream_id = record.transcript_state.start_stream()
    coordinator = _SoapSessionCoordinator(
        record=record,
        stream_id=stream_id,
        generation=1,
        queue=BoundedWsOutboundQueue(maxsize=64),
        llm_client=llm,
        timing=_fast_timing(),
    )
    return record, coordinator


def _plan_message(start: float = 0) -> str:
    return _dg_result(
        channel=0,
        text="毎食後に1錠服用してください。",
        is_final=True,
        speech_final=True,
        start=start,
    )


def test_short_voiceprint_pool_uses_selected_audio_and_emits_refinement() -> None:
    import struct

    vector = [1.0] + [0.0] * 31

    class SpeakerClient:
        model_id = "3dspeaker_campplus_zh_en_16k_contiguous_v2"
        embedding_dim = 32
        received: list[int] = []

        def extract_embedding_from_pcm16(
            self,
            pcm16_bytes: bytes,
            *,
            sample_rate: int = 16000,
            channels: int = 1,
            channel_index: int = 0,
        ) -> list[float]:
            assert (sample_rate, channels, channel_index) == (16000, 1, 0)
            assert set(struct.unpack(f"<{len(pcm16_bytes) // 2}h", pcm16_bytes)) <= {0, 4000}
            self.received.append(len(pcm16_bytes))
            return vector

    async def run() -> None:
        record, coordinator = _coordinator(FakeSoapLlmClient())
        speaker = SpeakerClient()
        coordinator._speaker_client = speaker
        state = record.transcript_state
        assert state.set_pharmacist_profile(model_id=speaker.model_id, embedding=vector)[0]
        # 2つの短発話の間には50msの無音がある。別chの音は混ぜない。
        for amplitude, duration in [(4000, 0.35), (0, 0.05), (4000, 0.35)]:
            state.append_pcm16(
                struct.pack("<hh", amplitude, 100) * round(16000 * duration),
                channels=2,
                sample_rate=16000,
            )
        await coordinator.handle_deepgram_message_async(
            _dg_result(
                channel=0,
                text="はい",
                is_final=True,
                speech_final=True,
                start=0,
                duration=0.35,
            )
        )
        assert state.finalized_segments[0].speaker_role == "unknown"
        assert speaker.received == []
        await coordinator.handle_deepgram_message_async(
            _dg_result(
                channel=0,
                text="そうです",
                is_final=True,
                speech_final=True,
                start=0.4,
                duration=0.35,
            )
        )
        assert len(speaker.received) == 1
        assert speaker.received[0] / 32000 == pytest.approx(0.75)
        assert [s.speaker_role for s in state.finalized_segments] == ["pharmacist", "pharmacist"]
        assert state.finalized_segments[0].status == "refined"
        emitted = [json.loads(payload) for _, payload in coordinator._queue._items]
        assert any(
            event.get("type") == "TranscriptUpdated"
            and event["segment"]["status"] == "refined"
            and event["segment"]["speaker_role"] == "pharmacist"
            for event in emitted
        )

    asyncio.run(run())


def test_precision_defaults_disable_mixing_and_audio_cutting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import Settings

    monkeypatch.delenv("STT_MONO_MIX_ENABLED", raising=False)
    monkeypatch.delenv("STT_VAD_ENABLED", raising=False)
    defaults = Settings()
    assert defaults.stt_mono_mix_enabled is False
    assert defaults.stt_vad_enabled is False


def test_affirmative_reply_reaches_llm_with_processed_question_context() -> None:
    class RecordingLlm(FakeSoapLlmClient):
        def __init__(self) -> None:
            super().__init__()
            self.payloads: list[dict[str, Any]] = []

        async def extract_spoa(self, payload: dict[str, Any]) -> dict[str, Any]:
            self.payloads.append(payload)
            return {"operations": []}

    async def _run() -> None:
        llm = RecordingLlm()
        record, coordinator = _coordinator(llm)
        coordinator.handle_deepgram_message(
            _dg_result(
                channel=0,
                text="頭痛はありますか。",
                is_final=True,
                speech_final=True,
                start=0,
                duration=1,
            )
        )
        await coordinator._run_extract_step(retries=0)
        coordinator.handle_deepgram_message(
            _dg_result(
                channel=1,
                text="はい。",
                is_final=True,
                speech_final=True,
                start=2,
                duration=0.3,
            )
        )
        await coordinator._run_extract_step(retries=0)
        assert len(llm.payloads) == 2
        assert llm.payloads[1]["new_segments"][0]["text"] == "はい。"
        assert llm.payloads[1]["recent_context_segments"][0]["text"] == "頭痛はありますか。"
        assert record.soap_manager.note.processed_transcript_revision == 2

    asyncio.run(_run())


def test_precision_stream_preserves_stereo_pcm_and_separate_speakers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import array

    from app.services import soap_stream_service, transcription_service

    for module in (soap_stream_service, transcription_service):
        monkeypatch.setattr(
            module,
            "settings",
            replace(module.settings, stt_mono_mix_enabled=False, stt_vad_enabled=False),
        )

    class RecordingClient(_StubDeepgramClient):
        requested_channels: int | None = None

        @asynccontextmanager
        async def connect_listen_stream(
            self,
            *,
            channels: int = 2,
            language: str = "ja",
            sample_rate: int = 16000,
            endpointing_ms: int = 300,
        ) -> AsyncIterator[DeepgramStreamProtocol]:
            self.requested_channels = channels
            yield self._stream

    async def _run() -> None:
        # 無音、小声、両者の同時発話を元の順序とチャンネルのまま送る
        chunks = [
            array.array("h", samples * 1600).tobytes()
            for samples in ([0, 0], [20, 80], [5000, 4000])
        ]
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                *chunks,
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = RecordingClient(
            [
                _dg_result(
                    channel=ch, text=text, is_final=True, speech_final=True, start=0.2, duration=0.1
                )
                for ch, text in [(0, "お薬を飲んでください。"), (1, "はい。")]
            ]
        )
        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(channels=2, enable_soap=True),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=_CountingLlmClient(),
            conversation_registry=ConversationSessionRegistry(),
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )
        assert dg.requested_channels == 2
        assert [p for p in dg._stream.sent_payloads if isinstance(p, bytes)] == chunks
        segments = [ev["segment"] for ev in ws.parsed_events() if ev["type"] == "TranscriptUpdated"]
        assert [(s["channel_index"], s["speaker_role"]) for s in segments] == [
            (0, "pharmacist"),
            (1, "patient"),
        ]
        assert all(s["start_sec"] == 0.2 for s in segments)

    asyncio.run(_run())


def test_superseded_coordinator_cannot_mutate_transcript_or_status() -> None:
    record, coordinator = _coordinator(FakeSoapLlmClient())
    record.active_generation += 1
    before_seq = record.event_seq
    coordinator.handle_deepgram_message(_plan_message())
    coordinator.enqueue_soap_status(status="error", has_unapplied_transcript=True)
    coordinator.enqueue_initial_snapshot()
    assert record.transcript_state.segments == []
    assert record.soap_status == "idle"
    assert record.event_seq == before_seq


def test_final_a_result_from_superseded_generation_is_discarded() -> None:
    async def _run() -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        class DelayedFinal(FakeSoapLlmClient):
            async def finalize_a_from_p(self, payload: dict[str, Any]) -> dict[str, Any]:
                started.set()
                await release.wait()
                return await super().finalize_a_from_p(payload)

        record, coordinator = _coordinator(DelayedFinal())
        coordinator.handle_deepgram_message(_plan_message())
        assert await coordinator._run_extract_step(retries=0)
        task = asyncio.create_task(coordinator._run_finalize_a_step())
        await asyncio.wait_for(started.wait(), timeout=1)
        before = record.soap_manager.note
        record.active_generation += 1
        record.soap_status = "pending"
        release.set()
        assert await task is False
        assert record.soap_manager.note == before
        assert record.soap_status == "pending"

    asyncio.run(_run())


@pytest.mark.parametrize(
    "code,expected_calls", [("LLM_INPUT_TOO_LARGE", 1), ("LLM_UNAVAILABLE", 2)]
)
def test_failed_batch_waits_for_new_input_instead_of_restarting_retries(
    code: str,
    expected_calls: int,
) -> None:
    async def _run() -> None:
        class Failing(FakeSoapLlmClient):
            calls = 0

            async def extract_spoa(self, payload: dict[str, Any]) -> dict[str, Any]:
                self.calls += 1
                raise SoapLlmClientError("生成失敗", code=code)

        llm = Failing()
        record, coordinator = _coordinator(llm)
        # 再試行可能エラーには初回 + 1回だけを許可する
        coordinator._timing = replace(_fast_timing(), llm_max_retries=1)
        coordinator.handle_deepgram_message(_plan_message())
        task = asyncio.create_task(coordinator.llm_worker_loop())
        try:
            async with asyncio.timeout(1):
                while record.soap_status != "error":
                    await asyncio.sleep(0.001)
            await asyncio.sleep(0.06)
            assert llm.calls == expected_calls
            assert record.soap_manager.note.processed_transcript_revision == 0
            assert await coordinator._run_extract_step(retries=0) is False
            assert llm.calls == expected_calls
            coordinator.handle_deepgram_message(_plan_message(3))
            async with asyncio.timeout(1):
                while llm.calls < expected_calls * 2:
                    await asyncio.sleep(0.001)
            assert llm.calls == expected_calls * 2
        finally:
            coordinator.request_stop_background_llm()
            await asyncio.wait_for(task, timeout=1)

    asyncio.run(_run())


def test_reconnecting_cancels_old_relay_and_ignores_its_queued_audio() -> None:
    async def _run() -> None:
        registry = ConversationSessionRegistry()
        auth = json.dumps({"type": "Auth", "access_token": "valid-token"})
        old_ws, new_ws = _StubClientWs([auth]), _StubClientWs([auth])
        old_dg, new_dg = _StubDeepgramClient([]), _StubDeepgramClient([])
        config = TranscriptionStreamConfig(channels=2, enable_soap=True, conversation_id="resume")

        async def relay(ws: _StubClientWs, dg: _StubDeepgramClient) -> None:
            await relay_deepgram_stream(
                ws,
                config,
                client=dg,
                auth_client=_StubAuthClient(),
                llm_client=FakeSoapLlmClient(),
                conversation_registry=registry,
                soap_timing=_fast_timing(),
                now_fn=lambda: 1_000_000.0,
            )

        old_task = asyncio.create_task(relay(old_ws, old_dg))
        new_task: asyncio.Task[None] | None = None
        try:
            async with asyncio.timeout(1):
                while not any(
                    ev["type"] == "ConversationSnapshot" for ev in old_ws.parsed_events()
                ):
                    await asyncio.sleep(0)
            new_task = asyncio.create_task(relay(new_ws, new_dg))
            async with asyncio.timeout(1):
                while not any(
                    ev["type"] == "ConversationSnapshot" for ev in new_ws.parsed_events()
                ):
                    await asyncio.sleep(0)
            old_ws._incoming.put_nowait(b"\x00\x01" * 8)
            await asyncio.wait_for(old_task, timeout=1)
            assert not any(isinstance(data, bytes) for data in old_dg._stream.sent_payloads)
            record = registry.get_or_create(user_id="user-1", conversation_id="resume")
            assert record.transcript_state.segments == []
            assert record.active_generation == 2
        finally:
            for task in (old_task, new_task):
                if task is not None:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

    asyncio.run(_run())


def test_auth_failure_opens_neither_deepgram_nor_llm() -> None:
    async def _run() -> None:
        ws = _StubClientWs([json.dumps({"type": "Auth", "access_token": "bad"})])
        dg = _StubDeepgramClient([])
        llm = _CountingLlmClient()
        closed: list[tuple[int, str]] = []

        async def _on_close(code: int, reason: str) -> None:
            closed.append((code, reason))

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(enable_soap=True, conversation_id="conv-auth-fail"),
            client=dg,
            on_close=_on_close,
            auth_client=_StubAuthClient(should_fail=True),
            llm_client=llm,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        assert dg.connect_calls == 0
        assert llm.extract_calls == 0
        assert llm.finalize_calls == 0
        assert closed[0][0] == 1008
        assert ws.parsed_events()[0]["type"] == "Error"

    asyncio.run(_run())


def test_soap_ws_end_to_end_events_sequence_and_finalize_a() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="昨日から喉が痛い",
                    is_final=False,
                    speech_final=False,
                    start=0.2,
                ),
                _dg_result(
                    channel=1,
                    text="昨日から喉が痛いです。",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                ),
                _dg_result(
                    channel=0,
                    text="毎食後に1錠服用してください。",
                    is_final=True,
                    speech_final=True,
                    start=1.5,
                ),
                _dg_result(
                    channel=0,
                    text="水またはぬるま湯で飲んでください。",
                    is_final=True,
                    speech_final=True,
                    start=3.0,
                ),
            ]
        )
        llm = _CountingLlmClient()
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(channels=2, enable_soap=True, conversation_id="conv-ws-e2e"),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        events = ws.parsed_events()
        assert events[0]["type"] == "AuthOk"
        conv_events = [ev for ev in events if ev["type"] != "AuthOk"]
        assert conv_events[0]["type"] == "ConversationSnapshot"
        assert conv_events[-1]["type"] == "ConversationCompleted"
        assert conv_events[-1]["reason"] == "stopped"
        assert conv_events[-1]["has_unapplied_transcript"] is False

        seqs = [ev["sequence"] for ev in conv_events]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)

        soap_updates = [ev for ev in conv_events if ev["type"] == "SoapUpdated"]
        assert soap_updates
        final_soap = soap_updates[-1]["soap"]
        assert len(final_soap["sections"]["S"]["items"]) == 1
        assert len(final_soap["sections"]["P"]["items"]) == 1
        assert (
            final_soap["sections"]["P"]["items"][0]["text"]
            == "毎食後に1錠服用してください。水またはぬるま湯で飲んでください。"
        )
        assert len(final_soap["sections"]["P"]["items"][0]["evidence"]) == 2
        assert any(
            item["origin"] == "plan_inference" for item in final_soap["sections"]["A"]["items"]
        )
        assert llm.finalize_calls == 1

    asyncio.run(_run())


def test_failing_llm_keeps_transcripts_flowing_and_skips_finalize_a_on_stop() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=0,
                    text="お薬を食後に飲んでください。",
                    is_final=True,
                    speech_final=True,
                    start=0.5,
                ),
            ]
        )
        llm = _CountingLlmClient(fail_extract=True)
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(
                channels=2, enable_soap=True, conversation_id="conv-llm-fail"
            ),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        events = ws.parsed_events()
        transcript_events = [ev for ev in events if ev["type"] == "TranscriptUpdated"]
        assert len(transcript_events) == 1
        assert transcript_events[0]["segment"]["text"] == "お薬を食後に飲んでください。"
        assert any(ev["type"] == "SoapStatus" and ev["status"] == "error" for ev in events)
        completed = [ev for ev in events if ev["type"] == "ConversationCompleted"][0]
        assert completed["has_unapplied_transcript"] is True
        # P の同期失敗時は古い P に基づく A 最終推測を実行しない
        assert llm.finalize_calls == 0

    asyncio.run(_run())


def test_single_mic_mode_disables_llm_soap_even_when_requested() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=0,
                    text="単一マイクの文字起こし",
                    is_final=True,
                    speech_final=True,
                    start=0.3,
                )
            ]
        )
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(
                channels=1, enable_soap=True, conversation_id="conv-single-mic"
            ),
            client=dg,
            auth_client=_StubAuthClient(),
            use_default_llm=True,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        events = ws.parsed_events()
        snapshot = [ev for ev in events if ev["type"] == "ConversationSnapshot"][0]
        assert snapshot["soap_status"] == "disabled"
        assert [ev for ev in events if ev["type"] == "SoapUpdated"] == []

    asyncio.run(_run())


def test_mono_mix_vad_skips_silence_sends_keepalive_and_restores_patient_speaker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import array

    from app.services import soap_stream_service, transcription_service

    monkeypatch.setattr(
        transcription_service,
        "settings",
        replace(transcription_service.settings, stt_mono_mix_enabled=True),
    )
    monkeypatch.setattr(
        soap_stream_service,
        "settings",
        replace(
            soap_stream_service.settings,
            stt_mono_mix_enabled=True,
            stt_vad_enabled=True,
            stt_vad_rms_threshold=0.01,
            stt_vad_preroll_ms=100,
            stt_vad_hangover_ms=100,
            stt_keepalive_interval_seconds=0.01,
        ),
    )

    def _stereo(*, left: int, right: int, ms: int) -> bytes:
        buf = array.array("h")
        for _ in range(int(16000 * ms / 1000)):
            buf.append(left)
            buf.append(right)
        return buf.tobytes()

    class _AudioSyncedDeepgramStream(_StubDeepgramStream):
        def __init__(self, responses: list[str]) -> None:
            super().__init__(responses)
            self._audio_sent = asyncio.Event()

        async def send(self, payload: bytes | str) -> None:
            await super().send(payload)
            if isinstance(payload, bytes):
                self._audio_sent.set()

        async def recv(self) -> bytes | str:
            await self._audio_sent.wait()
            return await super().recv()

    class _ChannelRecordingDeepgramClient(_StubDeepgramClient):
        def __init__(self, responses: list[str]) -> None:
            super().__init__(responses)
            self._stream = _AudioSyncedDeepgramStream(responses)
            self.requested_channels: list[int] = []

        @asynccontextmanager
        async def connect_listen_stream(
            self,
            *,
            channels: int = 2,
            language: str = "ja",
            sample_rate: int = 16000,
            endpointing_ms: int = 300,
        ) -> AsyncIterator[DeepgramStreamProtocol]:
            self.requested_channels.append(channels)
            async with super().connect_listen_stream(
                channels=channels,
                language=language,
                sample_rate=sample_rate,
                endpointing_ms=endpointing_ms,
            ) as stream:
                yield stream

    class _DelayedSilenceClientWs(_StubClientWs):
        async def receive_message(self) -> bytes | str | None:
            item = await super().receive_message()
            if isinstance(item, bytes):
                await asyncio.sleep(0.015)
            return item

    async def _run() -> None:
        silence = _stereo(left=5, right=5, ms=100)
        patient_speech = _stereo(left=20, right=6000, ms=100)
        ws = _DelayedSilenceClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                silence,
                silence,
                patient_speech,
                json.dumps({"type": "CloseStream"}),
            ]
        )
        # 1ch で返ってくるため channel_index=0 かつ圧縮時刻 start=0.1, duration=0.1
        # 実時刻では 0.2〜0.3s かつ患者 (ch1) へ復元されるはず
        dg = _ChannelRecordingDeepgramClient(
            [
                _dg_result(
                    channel=0,
                    text="頭が痛い",
                    is_final=False,
                    speech_final=False,
                    start=0.1,
                    duration=0.1,
                ),
                _dg_result(
                    channel=0,
                    text="昨日から頭が痛いです。",
                    is_final=True,
                    speech_final=True,
                    start=0.1,
                    duration=0.1,
                ),
            ]
        )
        llm = _CountingLlmClient()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(
                channels=2, enable_soap=True, conversation_id="conv-mono-vad"
            ),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            conversation_registry=ConversationSessionRegistry(),
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        assert dg.requested_channels == [1]
        sent_binary = [p for p in dg._stream.sent_payloads if isinstance(p, bytes)]
        assert len(sent_binary) == 1
        assert '{"type": "KeepAlive"}' in dg._stream.sent_payloads
        # プリロール 100ms + 発話 100ms = 200ms の 1ch PCM16 (16000 * 0.2 * 2 = 6400 bytes)
        assert len(sent_binary[0]) == 6400

        transcript_events = [ev for ev in ws.parsed_events() if ev["type"] == "TranscriptUpdated"]
        assert len(transcript_events) == 2
        # interim と final で同一 segment_id を維持し、患者 (ch1) かつ実時刻 0.2s へ復元
        assert (
            transcript_events[0]["segment"]["segment_id"]
            == transcript_events[1]["segment"]["segment_id"]
        )
        final_seg = transcript_events[1]["segment"]
        assert final_seg["speaker_role"] == "patient"
        assert final_seg["channel_index"] == 1
        assert abs(final_seg["start_sec"] - 0.2) < 1e-4

    asyncio.run(_run())


def test_short_replies_and_greetings_are_sent_to_llm() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="はい。",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                ),
                _dg_result(
                    channel=0,
                    text="ありがとうございます。",
                    is_final=True,
                    speech_final=True,
                    start=1.0,
                ),
            ]
        )
        llm = _CountingLlmClient()
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(
                channels=2, enable_soap=True, conversation_id="conv-skip-greeting"
            ),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        # 短い返答の意味は会話文脈に依存するため、ローカル判定で除外しない
        assert llm.extract_calls >= 1
        assert llm.finalize_calls == 0
        completed = [ev for ev in ws.parsed_events() if ev["type"] == "ConversationCompleted"][0]
        assert completed["has_unapplied_transcript"] is False

        # 否定表現（「いいえ、飲んでいません。」）はスキップせずに LLM へ渡す
        ws2 = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg2 = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="いいえ、飲んでいません。",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                ),
            ]
        )
        llm2 = _CountingLlmClient()
        await relay_deepgram_stream(
            ws2,
            TranscriptionStreamConfig(
                channels=2, enable_soap=True, conversation_id="conv-neg-reply"
            ),
            client=dg2,
            auth_client=_StubAuthClient(),
            llm_client=llm2,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )
        assert llm2.extract_calls == 1

    asyncio.run(_run())


def test_ws_speaker_profile_not_forwarded_to_deepgram_and_verifies_bleed() -> None:
    import array

    from app.services.speaker_service import normalize_embedding

    pharm_vec = normalize_embedding([1.0] + [0.0] * 31)
    assert pharm_vec is not None

    class _StubSpeakerClient:
        model_id = "3dspeaker_campplus_zh_en_16k_contiguous_v2"
        embedding_dim = 32

        def __init__(self, vec: list[float]) -> None:
            self.calls = 0
            self._vec = vec

        def extract_embedding_from_pcm16(
            self,
            pcm16_bytes: bytes,
            *,
            sample_rate: int = 16000,
            channels: int = 1,
            channel_index: int = 0,
        ) -> list[float] | None:
            self.calls += 1
            return list(self._vec)

    buf = array.array("h")
    for _ in range(32000):  # 2秒・2ch
        buf.append(4000)
        buf.append(1500)
    stereo_pcm = buf.tobytes()

    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps(
                    {
                        "type": "SpeakerProfile",
                        "model_id": "3dspeaker_campplus_zh_en_16k_contiguous_v2",
                        "embedding": pharm_vec,
                    }
                ),
                stereo_pcm,
                json.dumps({"type": "CloseStream"}),
            ]
        )
        # 薬剤師の声が ch1（患者マイク側）に混入した場合を模擬
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="朝食後に1錠お飲みください",
                    is_final=True,
                    speech_final=True,
                    start=0.1,
                    duration=1.5,
                )
            ]
        )
        llm = _CountingLlmClient()
        spk = _StubSpeakerClient(pharm_vec)
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(channels=2, enable_soap=True, conversation_id="conv-spk-ws"),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            speaker_client=spk,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        # SpeakerProfile は Deepgram へ転送しない
        assert not any(
            isinstance(p, str) and "SpeakerProfile" in p for p in dg._stream.sent_payloads
        )
        events = ws.parsed_events()
        acks = [ev for ev in events if ev.get("type") == "SpeakerProfileAck"]
        assert len(acks) == 1
        assert acks[0]["accepted"] is True

        assert spk.calls >= 1
        finals = [
            ev
            for ev in events
            if ev.get("type") == "TranscriptUpdated" and ev["segment"]["status"] == "final"
        ]
        assert len(finals) == 1
        # ch1 由来でも薬剤師声紋と一致したため pharmacist へ補正される
        assert finals[0]["segment"]["speaker_role"] == "pharmacist"

    asyncio.run(_run())


def test_ws_replaces_inferior_other_channel_duplicate_with_removed_event() -> None:
    import array

    from app.services.speaker_service import normalize_embedding

    pharm_vec = normalize_embedding([1.0] + [0.0] * 31)
    assert pharm_vec is not None

    class _StubSpeakerClient:
        model_id = "3dspeaker_campplus_zh_en_16k_contiguous_v2"
        embedding_dim = 32

        def __init__(self, vec: list[float]) -> None:
            self._vec = list(vec)

        def extract_embedding_from_pcm16(
            self,
            pcm16_bytes: bytes,
            *,
            sample_rate: int = 16000,
            channels: int = 1,
            channel_index: int = 0,
        ) -> list[float] | None:
            return list(self._vec)

    buf = array.array("h")
    for _ in range(48000):  # 3秒・2ch・近接マイク模擬
        buf.append(4200)
        buf.append(3900)
    stereo_pcm = buf.tobytes()

    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps(
                    {
                        "type": "SpeakerProfile",
                        "model_id": "3dspeaker_campplus_zh_en_16k_contiguous_v2",
                        "embedding": pharm_vec,
                    }
                ),
                stereo_pcm,
                json.dumps({"type": "CloseStream"}),
            ]
        )
        # ch1 誤認識「シャブンに」が先に届き、直後に ch0「処分に」が届く
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="シャブンに",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                    duration=1.1,
                    confidence=0.72,
                ),
                _dg_result(
                    channel=0,
                    text="処分に",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                    duration=1.1,
                    confidence=0.95,
                ),
            ]
        )
        llm = _CountingLlmClient()
        spk = _StubSpeakerClient(pharm_vec)
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(channels=2, enable_soap=True, conversation_id="conv-ws-dup"),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            speaker_client=spk,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        events = ws.parsed_events()
        transcript_events = [ev for ev in events if ev.get("type") == "TranscriptUpdated"]
        removed = [ev for ev in transcript_events if ev.get("removed") is True]
        assert len(removed) == 1
        assert removed[0]["segment"]["text"] == "シャブンに"

        kept = [
            ev["segment"]["text"]
            for ev in transcript_events
            if not ev.get("removed") and ev["segment"]["text"] != "シャブンに"
        ]
        assert kept == ["処分に"]

        record = registry.get_or_create(
            user_id="user-1",
            conversation_id="conv-ws-dup",
        )
        assert [seg.text for seg in record.transcript_state.finalized_segments] == ["処分に"]

    asyncio.run(_run())


def test_ws_splits_turn_switch_with_words_and_supports_manual_override() -> None:
    import array

    from app.services.speaker_service import normalize_embedding

    pharm_vec = normalize_embedding([1.0] + [0.0] * 31)
    patient_vec = normalize_embedding([0.0, 1.0] + [0.0] * 30)
    assert pharm_vec is not None
    assert patient_vec is not None

    class _AmpRoutingSpeakerClient:
        model_id = "3dspeaker_campplus_zh_en_16k_contiguous_v2"
        embedding_dim = 32

        def extract_embedding_from_pcm16(
            self,
            pcm16_bytes: bytes,
            *,
            sample_rate: int = 16000,
            channels: int = 1,
            channel_index: int = 0,
        ) -> list[float] | None:
            samples = array.array("h")
            samples.frombytes(pcm16_bytes[: len(pcm16_bytes) - (len(pcm16_bytes) % 2)])
            if not samples:
                return None
            avg_abs = sum(abs(s) for s in samples) / len(samples)
            # ch0=4200 または ch0=5000 は薬剤師、それ以外（患者優位等）は患者ベクトル
            assert pharm_vec is not None
            assert patient_vec is not None
            return list(pharm_vec if avg_abs >= 3800 else patient_vec)

    # [0..2.0s]: ch1 患者が話す（患者一時重心を登録）
    # [2.0..3.5s]: ch0 薬剤師 (amp=4500)
    # [3.5..5.5s]: ch0 に混ざる ch1 患者 (amp=2800 / 2800)
    # 実ストリーム同様に区間別フレームとして送信し、時刻別の RMS 履歴を保持させる
    pcm_part_0 = array.array("h", [400, 3000] * 32000).tobytes()
    pcm_part_1 = array.array("h", [4500, 600] * 24000).tobytes()
    pcm_part_2 = array.array("h", [2800, 2800] * 32000).tobytes()

    mixed_words_payload = json.dumps(
        {
            "type": "Results",
            "channel_index": [0, 2],
            "start": 2.1,
            "duration": 3.2,
            "is_final": True,
            "speech_final": True,
            "channel": {
                "alternatives": [
                    {
                        "transcript": "今日は体調どうですか。昨日から少し熱があります。",
                        "confidence": 0.94,
                        "words": [
                            {
                                "punctuated_word": "今日は",
                                "start": 2.1,
                                "end": 2.5,
                                "confidence": 0.95,
                            },
                            {
                                "punctuated_word": "体調",
                                "start": 2.5,
                                "end": 2.9,
                                "confidence": 0.95,
                            },
                            {
                                "punctuated_word": "どうですか。",
                                "start": 2.9,
                                "end": 3.4,
                                "confidence": 0.95,
                            },
                            {
                                "punctuated_word": "昨日から",
                                "start": 3.9,
                                "end": 4.4,
                                "confidence": 0.93,
                            },
                            {
                                "punctuated_word": "少し",
                                "start": 4.4,
                                "end": 4.7,
                                "confidence": 0.93,
                            },
                            {
                                "punctuated_word": "熱があります。",
                                "start": 4.7,
                                "end": 5.3,
                                "confidence": 0.93,
                            },
                        ],
                    }
                ]
            },
        },
        ensure_ascii=False,
    )

    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
                json.dumps(
                    {
                        "type": "SpeakerProfile",
                        "model_id": "3dspeaker_campplus_zh_en_16k_contiguous_v2",
                        "embedding": pharm_vec,
                    }
                ),
                pcm_part_0,
                pcm_part_1,
                pcm_part_2,
                json.dumps({"type": "CloseStream"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=1,
                    text="よろしくお願いします。",
                    is_final=True,
                    speech_final=True,
                    start=0.1,
                    duration=1.6,
                ),
                mixed_words_payload,
            ]
        )
        llm = _CountingLlmClient()
        spk = _AmpRoutingSpeakerClient()
        registry = ConversationSessionRegistry()

        await relay_deepgram_stream(
            ws,
            TranscriptionStreamConfig(channels=2, enable_soap=True, conversation_id="conv-split"),
            client=dg,
            auth_client=_StubAuthClient(),
            llm_client=llm,
            speaker_client=spk,
            conversation_registry=registry,
            soap_timing=_fast_timing(),
            now_fn=lambda: 1_000_000.0,
        )

        record = registry.get_or_create(user_id="user-1", conversation_id="conv-split")
        finals = record.transcript_state.finalized_segments
        assert [(s.speaker_role, s.text) for s in finals] == [
            ("patient", "よろしくお願いします。"),
            ("pharmacist", "今日は体調どうですか。"),
            ("patient", "昨日から少し熱があります。"),
        ]

    asyncio.run(_run())


def test_ws_manual_speaker_override_updates_segment_and_reconciles_soap() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=0,
                    text="毎食後に1錠飲んでください",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                    duration=1.2,
                )
            ]
        )
        llm = _CountingLlmClient()
        registry = ConversationSessionRegistry()

        task = asyncio.create_task(
            relay_deepgram_stream(
                ws,
                TranscriptionStreamConfig(
                    channels=2, enable_soap=True, conversation_id="conv-override"
                ),
                client=dg,
                auth_client=_StubAuthClient(),
                llm_client=llm,
                conversation_registry=registry,
                soap_timing=_fast_timing(),
            )
        )

        # 初回 SOAP 生成（P に反映）まで待機してから、話者を unknown へ手動訂正する
        for _ in range(80):
            events = ws.parsed_events()
            if any(
                ev.get("type") == "SoapUpdated" and ev["soap"]["sections"]["P"]["items"]
                for ev in events
            ):
                break
            await asyncio.sleep(0.02)

        record = registry.get_or_create(user_id="user-1", conversation_id="conv-override")
        seg = record.transcript_state.finalized_segments[0]
        await ws._incoming.put(
            json.dumps(
                {
                    "type": "UpdateSegmentSpeaker",
                    "stream_id": seg.stream_id,
                    "segment_id": seg.segment_id,
                    "speaker_role": "unknown",
                }
            )
        )
        for _ in range(80):
            events = ws.parsed_events()
            if any(
                ev.get("type") == "SoapUpdated" and ev.get("retracted_item_ids") for ev in events
            ):
                break
            await asyncio.sleep(0.02)

        await ws._incoming.put(json.dumps({"type": "CloseStream"}))
        await task

        events = ws.parsed_events()
        refined_transcript = [
            ev
            for ev in events
            if ev.get("type") == "TranscriptUpdated"
            and ev["segment"]["segment_id"] == seg.segment_id
            and ev["segment"]["status"] == "refined"
        ]
        assert refined_transcript
        assert refined_transcript[-1]["segment"]["speaker_role"] == "unknown"

        soap_updates = [ev for ev in events if ev.get("type") == "SoapUpdated"]
        assert any(ev.get("retracted_item_ids") for ev in soap_updates)
        assert soap_updates[-1]["soap"]["sections"]["P"]["items"] == []

    asyncio.run(_run())


def test_ws_delete_segment_removes_utterance_and_reconciles_soap() -> None:
    async def _run() -> None:
        ws = _StubClientWs(
            [
                json.dumps({"type": "Auth", "access_token": "valid-token"}),
            ]
        )
        dg = _StubDeepgramClient(
            [
                _dg_result(
                    channel=0,
                    text="毎食後に1錠飲んでください",
                    is_final=True,
                    speech_final=True,
                    start=0.2,
                    duration=1.2,
                )
            ]
        )
        llm = _CountingLlmClient()
        registry = ConversationSessionRegistry()

        task = asyncio.create_task(
            relay_deepgram_stream(
                ws,
                TranscriptionStreamConfig(
                    channels=2, enable_soap=True, conversation_id="conv-delete-ws"
                ),
                client=dg,
                auth_client=_StubAuthClient(),
                llm_client=llm,
                conversation_registry=registry,
                soap_timing=_fast_timing(),
            )
        )

        for _ in range(80):
            events = ws.parsed_events()
            if any(
                ev.get("type") == "SoapUpdated" and ev["soap"]["sections"]["P"]["items"]
                for ev in events
            ):
                break
            await asyncio.sleep(0.02)

        record = registry.get_or_create(user_id="user-1", conversation_id="conv-delete-ws")
        seg = record.transcript_state.finalized_segments[0]
        await ws._incoming.put(
            json.dumps(
                {
                    "type": "DeleteSegment",
                    "stream_id": seg.stream_id,
                    "segment_id": seg.segment_id,
                }
            )
        )
        for _ in range(80):
            events = ws.parsed_events()
            if any(
                ev.get("type") == "SoapUpdated" and ev.get("retracted_item_ids") for ev in events
            ):
                break
            await asyncio.sleep(0.02)

        await ws._incoming.put(json.dumps({"type": "CloseStream"}))
        await task

        events = ws.parsed_events()
        removed_events = [
            ev
            for ev in events
            if ev.get("type") == "TranscriptUpdated"
            and ev.get("removed") is True
            and ev["segment"]["segment_id"] == seg.segment_id
        ]
        assert len(removed_events) == 1
        assert record.transcript_state.finalized_segments == []

        soap_updates = [ev for ev in events if ev.get("type") == "SoapUpdated"]
        assert any(ev.get("retracted_item_ids") for ev in soap_updates)
        assert soap_updates[-1]["soap"]["sections"]["P"]["items"] == []

    asyncio.run(_run())


def test_rest_delete_conversation_segment_reconciles_soap_after_stop() -> None:
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers.dependencies import get_current_user
    from app.schemas.auth import AuthenticatedUser
    from app.services.conversation_service import DeepgramTranscriptInput
    from app.services.soap_stream_service import get_default_conversation_registry

    registry = get_default_conversation_registry()
    record = registry.get_or_create(user_id="user-rest-del", conversation_id="conv-rest-del")
    stream_id = record.transcript_state.start_stream("s-rest")
    res = record.transcript_state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "毎食後に服用してください", True, True, 0.1, 1.0, 0.95),
    )
    assert res.segment is not None
    record.soap_manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "section": "P",
                    "action": "add",
                    "text": "毎食後に服用指導。",
                    "evidence_refs": [
                        {
                            "stream_id": stream_id,
                            "segment_id": res.segment.segment_id,
                            "segment_revision": res.segment.segment_revision,
                            "quote": "毎食後に服用してください",
                            "speaker_role": "pharmacist",
                        }
                    ],
                }
            ]
        },
        segments_lookup={(stream_id, res.segment.segment_id): res.segment},
        processed_transcript_revision=record.transcript_state.transcript_revision,
    )

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        user_id="user-rest-del",
        email="pharm@example.com",
        role="authenticated",
        expires_at=9999999999,
    )
    try:
        client = TestClient(app)
        resp = client.delete(
            f"/api/transcriptions/conversations/conv-rest-del/segments?stream_id={stream_id}&segment_id={res.segment.segment_id}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["conversation_id"] == "conv-rest-del"
        assert body["segment"]["segment_id"] == res.segment.segment_id
        assert body["retracted_item_ids"]
        assert body["soap"]["sections"]["P"]["items"] == []

        resp_missing = client.delete(
            f"/api/transcriptions/conversations/conv-rest-del/segments?stream_id={stream_id}&segment_id={res.segment.segment_id}"
        )
        assert resp_missing.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_concurrent_speaker_override_during_extract_retries_with_fresh_snapshot() -> None:
    from app.services.conversation_service import DeepgramTranscriptInput

    class _ConcurrentMutationLlmClient(FakeSoapLlmClient):
        def __init__(self) -> None:
            super().__init__()
            self.extract_calls = 0
            self.coordinator: _SoapSessionCoordinator | None = None
            self.target_stream_id = ""
            self.target_segment_id = ""

        async def extract_spoa(self, payload: dict[str, Any]) -> dict[str, Any]:
            self.extract_calls += 1
            if self.extract_calls == 1 and self.coordinator is not None:
                # 1回目の LLM 呼び出し中にクライアントから話者手動訂正が入った状況を再現する
                self.coordinator.handle_segment_speaker_override(
                    {
                        "type": "UpdateSegmentSpeaker",
                        "stream_id": self.target_stream_id,
                        "segment_id": self.target_segment_id,
                        "speaker_role": "patient",
                    }
                )
                return {
                    "operations": [
                        {
                            "section": "S",
                            "action": "add",
                            "text": "昨日から頭痛が続いている。",
                            "evidence_refs": [
                                {
                                    "stream_id": self.target_stream_id,
                                    "segment_id": self.target_segment_id,
                                    "segment_revision": 1,
                                    "quote": "昨日から頭が痛いです",
                                    "speaker_role": "patient",
                                }
                            ],
                        }
                    ]
                }
            return await super().extract_spoa(payload)

    async def _run() -> None:
        registry = ConversationSessionRegistry()
        record = registry.get_or_create(user_id="user-race", conversation_id="conv-race")
        stream_id = record.transcript_state.start_stream("s-race")
        queue = BoundedWsOutboundQueue(maxsize=64)
        llm = _ConcurrentMutationLlmClient()
        coordinator = _SoapSessionCoordinator(
            record=record,
            stream_id=stream_id,
            generation=record.active_generation,
            queue=queue,
            llm_client=llm,
            timing=_fast_timing(),
        )
        # 初期誤判定 (channel 0 = pharmacist) を抽出中に手動で patient へ補正する
        res = record.transcript_state.apply_deepgram_event(
            DeepgramTranscriptInput(0, "昨日から頭が痛いです", True, True, 0.2, 1.0, 0.95),
        )
        assert res.segment is not None
        llm.coordinator = coordinator
        llm.target_stream_id = stream_id
        llm.target_segment_id = res.segment.segment_id

        ok = await coordinator._run_extract_step(retries=0)
        assert ok is True
        assert llm.extract_calls == 2
        assert coordinator._failed_extract_revision is None
        assert record.soap_status == "ready"
        assert len(record.soap_manager.note.sections.S.items) == 1

    asyncio.run(_run())


def test_unknown_only_batch_skips_llm_until_speaker_assigned() -> None:
    from app.services.conversation_service import DeepgramTranscriptInput

    async def _run() -> None:
        registry = ConversationSessionRegistry()
        record = registry.get_or_create(user_id="user-unk", conversation_id="conv-unk-skip")
        stream_id = record.transcript_state.start_stream("s-unk")
        queue = BoundedWsOutboundQueue(maxsize=64)
        llm = _CountingLlmClient()
        coordinator = _SoapSessionCoordinator(
            record=record,
            stream_id=stream_id,
            generation=record.active_generation,
            queue=queue,
            llm_client=llm,
            timing=_fast_timing(),
        )
        res = record.transcript_state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "昨日から頭が痛いです", True, True, 0.2, 1.0, 0.95),
        )
        assert res.segment is not None
        record.transcript_state.override_segment_speaker(
            stream_id=stream_id,
            segment_id=res.segment.segment_id,
            speaker_role="unknown",
        )

        ok_unknown = await coordinator._run_extract_step(retries=0)
        assert ok_unknown is True
        assert llm.extract_calls == 0
        assert (
            record.soap_manager.note.processed_transcript_revision
            == record.transcript_state.transcript_revision
        )
        assert record.soap_status == "ready"

        coordinator.handle_segment_speaker_override(
            {
                "type": "UpdateSegmentSpeaker",
                "stream_id": stream_id,
                "segment_id": res.segment.segment_id,
                "speaker_role": "patient",
            }
        )
        ok_patient = await coordinator._run_extract_step(retries=0)
        assert ok_patient is True
        assert llm.extract_calls == 1
        assert len(record.soap_manager.note.sections.S.items) == 1

    asyncio.run(_run())


def test_audio_ring_and_level_history_are_thread_safe_under_concurrent_rw() -> None:
    from concurrent.futures import ThreadPoolExecutor

    from app.services.conversation_service import (
        BackendAudioLevelHistory,
        BackendAudioPcmRingBuffer,
    )

    ring = BackendAudioPcmRingBuffer(max_history_seconds=5.0)
    levels = BackendAudioLevelHistory(max_history_seconds=5.0)
    pcm_chunk = b"\x00\x10\x00\x20" * 320  # 320 frames @ 16kHz = 20ms stereo

    def _writer() -> None:
        for _ in range(400):
            ring.append_pcm16(pcm_chunk, channels=2, sample_rate=16000)
            levels.append_pcm16(pcm_chunk, channels=2, sample_rate=16000)

    def _reader() -> None:
        for idx in range(400):
            t = (idx % 50) * 0.02
            ring.slice_pcm16(t, t + 0.1)
            ring.estimate_noise_floor()
            levels.levels_for(t, t + 0.1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_w = pool.submit(_writer)
        f_r = pool.submit(_reader)
        f_w.result()
        f_r.result()
