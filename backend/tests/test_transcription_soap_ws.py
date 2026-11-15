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
) -> str:
    return json.dumps(
        {
            "type": "Results",
            "channel_index": [channel, 2],
            "start": start,
            "duration": duration,
            "is_final": is_final,
            "speech_final": speech_final,
            "channel": {"alternatives": [{"transcript": text, "confidence": 0.95}]},
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
        model_id = "3dspeaker_campplus_zh_en_16k"
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
                        "model_id": "3dspeaker_campplus_zh_en_16k",
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
