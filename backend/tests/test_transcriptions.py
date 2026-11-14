import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app.clients.deepgram_client import (
    DeepgramClientError,
    DeepgramStreamProtocol,
    build_deepgram_listen_url,
)
from app.main import app
from app.schemas.transcription import TranscriptionStreamConfig
from app.services.transcription_service import relay_deepgram_stream

client = TestClient(app)


class _StubDeepgramStream:
    """テスト用の Deepgram WebSocket ストリーム二重化スタブ。"""

    def __init__(self, incoming_from_deepgram: list[bytes | str] | None = None) -> None:
        self.sent_messages: list[bytes | str] = []
        self._incoming: asyncio.Queue[bytes | str | None] = asyncio.Queue()
        for item in incoming_from_deepgram or []:
            self._incoming.put_nowait(item)
        self._incoming.put_nowait(None)
        self.closed = False

    async def send(self, message: bytes | str) -> None:
        self.sent_messages.append(message)

    async def recv(self) -> bytes | str:
        item = await self._incoming.get()
        if item is None:
            raise EOFError("stream finished")
        return item

    async def close(self) -> None:
        self.closed = True


class _StubDeepgramClient:
    """テスト用の Deepgram クライアントスタブ。"""

    def __init__(
        self,
        stream: DeepgramStreamProtocol | None = None,
        error: Exception | None = None,
    ) -> None:
        self._stream = stream
        self._error = error
        self.recorded_params: dict[str, int | str] | None = None

    @asynccontextmanager
    async def connect_listen_stream(
        self,
        *,
        channels: int = 2,
        language: str = "ja",
        sample_rate: int = 16000,
        endpointing_ms: int = 300,
    ) -> AsyncIterator[DeepgramStreamProtocol]:
        self.recorded_params = {
            "channels": channels,
            "language": language,
            "sample_rate": sample_rate,
            "endpointing_ms": endpointing_ms,
        }
        if self._error is not None:
            raise self._error
        assert self._stream is not None
        yield self._stream


class _StubClientWebSocket:
    """サービス層単体テスト用のブラウザ側 WebSocket スタブ。"""

    def __init__(self, incoming_from_client: list[bytes | str | None]) -> None:
        self._incoming: asyncio.Queue[bytes | str | None] = asyncio.Queue()
        for item in incoming_from_client:
            self._incoming.put_nowait(item)
        self.sent_texts: list[str] = []

    async def receive_message(self) -> bytes | str | None:
        return await self._incoming.get()

    async def send_text(self, text: str) -> None:
        self.sent_texts.append(text)


def test_build_deepgram_listen_url_formats_2ch_and_1ch_params() -> None:
    url_2ch = build_deepgram_listen_url(
        channels=2, language="ja", sample_rate=16000, endpointing_ms=300
    )
    parsed_2ch = urlparse(url_2ch)
    query_2ch = parse_qs(parsed_2ch.query)

    assert parsed_2ch.scheme in {"ws", "wss"}
    assert parsed_2ch.path == "/v1/listen"
    assert query_2ch["model"] == ["nova-3"]
    assert query_2ch["channels"] == ["2"]
    assert query_2ch["multichannel"] == ["true"]
    assert query_2ch["encoding"] == ["linear16"]
    assert query_2ch["sample_rate"] == ["16000"]

    url_1ch = build_deepgram_listen_url(
        channels=1, language="ja", sample_rate=16000, endpointing_ms=300
    )
    query_1ch = parse_qs(urlparse(url_1ch).query)
    assert query_1ch["channels"] == ["1"]
    assert "multichannel" not in query_1ch


def test_relay_deepgram_stream_forwards_binary_and_text() -> None:
    pcm_chunk = b"\x01\x00\x02\x00"
    transcript_json = json.dumps({"type": "Results", "is_final": True})
    deepgram_stream = _StubDeepgramStream(incoming_from_deepgram=[transcript_json])
    stub_client = _StubDeepgramClient(stream=deepgram_stream)
    client_ws = _StubClientWebSocket(
        incoming_from_client=[pcm_chunk, '{"type": "KeepAlive"}', None]
    )

    asyncio.run(
        relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(channels=2, language="ja"),
            client=stub_client,
        )
    )

    assert stub_client.recorded_params == {
        "channels": 2,
        "language": "ja",
        "sample_rate": 16000,
        "endpointing_ms": 300,
    }
    assert deepgram_stream.sent_messages == [
        pcm_chunk,
        '{"type": "KeepAlive"}',
        '{"type": "CloseStream"}',
    ]
    assert client_ws.sent_texts == [transcript_json]


def test_relay_deepgram_stream_emits_error_and_closes_on_client_error() -> None:
    stub_client = _StubDeepgramClient(
        error=DeepgramClientError("DEEPGRAM_KEY が設定されていません。", status_code=503)
    )
    client_ws = _StubClientWebSocket(incoming_from_client=[None])
    closed_calls: list[tuple[int, str]] = []

    async def _on_close(code: int, reason: str) -> None:
        closed_calls.append((code, reason))

    asyncio.run(
        relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(),
            client=stub_client,
            on_close=_on_close,
        )
    )

    assert len(client_ws.sent_texts) == 1
    payload = json.loads(client_ws.sent_texts[0])
    assert payload == {"type": "Error", "message": "DEEPGRAM_KEY が設定されていません。"}
    assert closed_calls == [(1011, "deepgram error")]


def test_websocket_transcriptions_relays_messages(monkeypatch) -> None:
    transcript_json = json.dumps(
        {
            "type": "Results",
            "channel_index": [0, 2],
            "is_final": True,
            "speech_final": True,
            "channel": {"alternatives": [{"transcript": "おはようございます", "confidence": 0.99}]},
        }
    )

    class _InteractiveDeepgramStream:
        def __init__(self) -> None:
            self.sent_messages: list[bytes | str] = []
            self._replies: asyncio.Queue[bytes | str | None] = asyncio.Queue()

        async def send(self, message: bytes | str) -> None:
            self.sent_messages.append(message)
            if isinstance(message, bytes):
                await self._replies.put(transcript_json)
            elif "CloseStream" in message:
                await self._replies.put(None)

        async def recv(self) -> bytes | str:
            item = await self._replies.get()
            if item is None:
                raise EOFError("closed")
            return item

        async def close(self) -> None:
            pass

    stream = _InteractiveDeepgramStream()
    stub_client = _StubDeepgramClient(stream=stream)
    monkeypatch.setattr(
        "app.services.transcription_service.DeepgramClient",
        lambda: stub_client,
    )

    with client.websocket_connect(
        "/api/transcriptions/ws?channels=2&language=ja&sample_rate=16000&endpointing=300"
    ) as ws:
        ws.send_bytes(b"\x10\x00\x20\x00")
        received = ws.receive_text()
        assert json.loads(received) == json.loads(transcript_json)

    assert stub_client.recorded_params == {
        "channels": 2,
        "language": "ja",
        "sample_rate": 16000,
        "endpointing_ms": 300,
    }
    assert b"\x10\x00\x20\x00" in stream.sent_messages


def test_websocket_transcriptions_sends_error_event_when_deepgram_fails(monkeypatch) -> None:
    stub_client = _StubDeepgramClient(
        error=DeepgramClientError("Deepgram WebSocket 認証エラー", status_code=401)
    )
    monkeypatch.setattr(
        "app.services.transcription_service.DeepgramClient",
        lambda: stub_client,
    )

    with client.websocket_connect("/api/transcriptions/ws?channels=1") as ws:
        received = json.loads(ws.receive_text())
        assert received == {"type": "Error", "message": "Deepgram WebSocket 認証エラー"}


def test_graceful_stop_waits_for_delayed_final_result() -> None:
    async def scenario() -> None:
        close_requested = asyncio.Event()

        class Stream(_StubDeepgramStream):
            def __init__(self) -> None:
                super().__init__()
                self.delivered = False

            async def send(self, message: bytes | str) -> None:
                if isinstance(message, str) and "CloseStream" in message:
                    close_requested.set()

            async def recv(self) -> bytes | str:
                await close_requested.wait()
                if self.delivered:
                    raise EOFError("complete")
                await asyncio.sleep(0.01)
                self.delivered = True
                return '{"type":"Results","is_final":true,"text":"final"}'

        stream = Stream()
        client_ws = _StubClientWebSocket(['{"type":"CloseStream"}'])
        closes: list[int] = []

        async def close(code: int, reason: str) -> None:
            closes.append(code)

        await relay_deepgram_stream(
            client_ws, TranscriptionStreamConfig(), _StubDeepgramClient(stream), close
        )
        assert len(client_ws.sent_texts) == 1
        assert json.loads(client_ws.sent_texts[0])["is_final"] is True
        assert closes == [1000]

    asyncio.run(scenario())


def test_graceful_stop_timeout_cancels_receiver(monkeypatch) -> None:
    monkeypatch.setattr("app.services.transcription_service.FINAL_RESULTS_TIMEOUT_SECONDS", 0.01)

    async def scenario() -> None:
        cancelled = asyncio.Event()

        class Stream(_StubDeepgramStream):
            async def recv(self) -> bytes | str:
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
                raise AssertionError("unreachable")

        client_ws = _StubClientWebSocket(['{"type":"CloseStream"}'])
        closes: list[int] = []

        async def close(code: int, reason: str) -> None:
            closes.append(code)

        await relay_deepgram_stream(
            client_ws, TranscriptionStreamConfig(), _StubDeepgramClient(Stream()), close
        )
        assert cancelled.is_set()
        assert closes == [1011]
        assert json.loads(client_ws.sent_texts[0])["type"] == "Error"

    asyncio.run(scenario())
