import asyncio
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.clients.deepgram_client import (
    DeepgramClientError,
    DeepgramStreamProtocol,
    build_deepgram_listen_url,
)
from app.clients.supabase_auth_client import AuthClientError
from app.main import app
from app.schemas.auth import AuthenticatedUser
from app.schemas.transcription import TranscriptionStreamConfig
from app.services.transcription_service import relay_deepgram_stream

client = TestClient(app)
DEFAULT_ORIGIN = "http://localhost:3000"


def _auth_frame(token: str = "valid-jwt") -> str:
    return json.dumps({"type": "Auth", "access_token": token})


class _StubAuthClient:
    """テスト用の認証クライアントスタブ。"""

    def __init__(
        self,
        user: AuthenticatedUser | None = None,
        error: AuthClientError | None = None,
    ) -> None:
        self._user = user
        self._error = error
        self.received_tokens: list[str] = []

    async def verify_access_token(self, token: str) -> AuthenticatedUser:
        self.received_tokens.append(token)
        if self._error is not None:
            raise self._error
        if self._user is not None:
            return self._user
        return AuthenticatedUser(
            user_id="user-1",
            email="test@example.com",
            role="authenticated",
            expires_at=int(time.time()) + 300,
        )


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
        self.connect_count = 0

    @asynccontextmanager
    async def connect_listen_stream(
        self,
        *,
        channels: int = 2,
        language: str = "ja",
        sample_rate: int = 16000,
        endpointing_ms: int = 300,
    ) -> AsyncIterator[DeepgramStreamProtocol]:
        self.connect_count += 1
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


def test_relay_deepgram_stream_forwards_binary_and_text_after_auth() -> None:
    pcm_chunk = b"\x01\x00\x02\x00"
    transcript_json = json.dumps({"type": "Results", "is_final": True})
    deepgram_stream = _StubDeepgramStream(incoming_from_deepgram=[transcript_json])
    stub_client = _StubDeepgramClient(stream=deepgram_stream)
    stub_auth = _StubAuthClient()
    client_ws = _StubClientWebSocket(
        incoming_from_client=[_auth_frame("jwt-1"), pcm_chunk, '{"type": "KeepAlive"}', None]
    )

    asyncio.run(
        relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(channels=2, language="ja"),
            client=stub_client,
            auth_client=stub_auth,
        )
    )

    assert stub_auth.received_tokens == ["jwt-1"]
    assert stub_client.connect_count == 1
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
    assert json.loads(client_ws.sent_texts[0])["type"] == "AuthOk"
    assert client_ws.sent_texts[1] == transcript_json


def test_relay_rejects_unauthenticated_frames_and_never_connects_deepgram() -> None:
    for first_frame in (
        b"\x01\x00",
        '{"type": "KeepAlive"}',
        "not-json",
        json.dumps({"type": "Auth", "access_token": "a" * 20000}),
    ):
        deepgram_client = _StubDeepgramClient(stream=_StubDeepgramStream())
        client_ws = _StubClientWebSocket(incoming_from_client=[first_frame])
        closes: list[int] = []

        async def _on_close(code: int, _reason: str, log: list[int] = closes) -> None:
            log.append(code)

        asyncio.run(
            relay_deepgram_stream(
                client_ws=client_ws,
                config=TranscriptionStreamConfig(),
                client=deepgram_client,
                on_close=_on_close,
                auth_client=_StubAuthClient(),
            )
        )

        assert deepgram_client.connect_count == 0
        assert closes == [1008]
        assert json.loads(client_ws.sent_texts[0])["type"] == "Error"


def test_relay_rejects_auth_timeout_without_deepgram_connection() -> None:
    class _SilentClientWs(_StubClientWebSocket):
        async def receive_message(self) -> bytes | str | None:
            await asyncio.sleep(0.2)
            return None

    deepgram_client = _StubDeepgramClient(stream=_StubDeepgramStream())
    client_ws = _SilentClientWs([])
    closes: list[int] = []

    async def _on_close(code: int, _reason: str) -> None:
        closes.append(code)

    asyncio.run(
        relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(),
            client=deepgram_client,
            on_close=_on_close,
            auth_client=_StubAuthClient(),
            auth_timeout_seconds=0.02,
        )
    )

    assert deepgram_client.connect_count == 0
    assert closes == [1008]
    err = json.loads(client_ws.sent_texts[0])
    assert err["type"] == "Error"
    assert err["code"] == "AUTH_TIMEOUT"


def test_relay_deepgram_stream_emits_error_and_closes_on_client_error() -> None:
    stub_client = _StubDeepgramClient(
        error=DeepgramClientError("DEEPGRAM_KEY が設定されていません。", status_code=503)
    )
    client_ws = _StubClientWebSocket(incoming_from_client=[_auth_frame(), None])
    closed_calls: list[tuple[int, str]] = []

    async def _on_close(code: int, reason: str) -> None:
        closed_calls.append((code, reason))

    asyncio.run(
        relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(),
            client=stub_client,
            on_close=_on_close,
            auth_client=_StubAuthClient(),
        )
    )

    assert len(client_ws.sent_texts) == 1
    payload = json.loads(client_ws.sent_texts[0])
    assert payload == {
        "type": "Error",
        "code": "UPSTREAM_ERROR",
        "message": "DEEPGRAM_KEY が設定されていません。",
    }
    assert closed_calls == [(1011, "deepgram error")]


def test_relay_stops_new_pcm_and_flushes_final_results_on_session_expiry() -> None:
    async def scenario() -> None:
        close_requested = asyncio.Event()

        class _ExpiringStream(_StubDeepgramStream):
            def __init__(self) -> None:
                super().__init__()
                self.delivered = False

            async def send(self, message: bytes | str) -> None:
                self.sent_messages.append(message)
                if isinstance(message, str) and "CloseStream" in message:
                    close_requested.set()

            async def recv(self) -> bytes | str:
                await close_requested.wait()
                if self.delivered:
                    raise EOFError("done")
                await asyncio.sleep(0.01)
                self.delivered = True
                return '{"type":"Results","is_final":true,"text":"最後の確定結果"}'

        class _ContinuousClientWs(_StubClientWebSocket):
            def __init__(self) -> None:
                super().__init__([_auth_frame()])

            async def receive_message(self) -> bytes | str | None:
                if not self._incoming.empty():
                    return await self._incoming.get()
                await asyncio.sleep(0.02)
                return b"\x01\x00"

        now = 1_700_000_000.0
        auth_client = _StubAuthClient(
            user=AuthenticatedUser(
                user_id="user-1",
                role="authenticated",
                expires_at=int(now) + 100,
            )
        )
        stream = _ExpiringStream()
        client_ws = _ContinuousClientWs()
        closes: list[int] = []

        async def _on_close(code: int, _reason: str) -> None:
            closes.append(code)

        # 0.05 秒後に期限切れとなる短いセッション上限で検証する
        await relay_deepgram_stream(
            client_ws=client_ws,
            config=TranscriptionStreamConfig(),
            client=_StubDeepgramClient(stream),
            on_close=_on_close,
            auth_client=auth_client,
            max_session_seconds=1,
            now_fn=lambda: now + 0.94,
        )

        decoded = [json.loads(item) for item in client_ws.sent_texts]
        assert decoded[0]["type"] == "AuthOk"
        assert decoded[1]["type"] == "Results"
        assert decoded[1]["is_final"] is True
        assert decoded[2]["type"] == "Error"
        assert decoded[2]["code"] == "SESSION_LIMIT_REACHED"
        assert closes == [1000]
        # CloseStream の後に新しい PCM が Deepgram へ送られていないことを確認する
        close_idx = stream.sent_messages.index('{"type": "CloseStream"}')
        assert all(not isinstance(m, bytes) for m in stream.sent_messages[close_idx + 1 :])

    asyncio.run(scenario())


def test_websocket_rejects_missing_or_disallowed_origin(monkeypatch) -> None:
    deepgram_client = _StubDeepgramClient(stream=_StubDeepgramStream())
    monkeypatch.setattr(
        "app.services.transcription_service.DeepgramClient",
        lambda: deepgram_client,
    )

    for headers in ({}, {"origin": "https://evil.example"}):
        try:
            with client.websocket_connect("/api/transcriptions/ws?channels=1", headers=headers):
                raise AssertionError("許可外 Origin が接続されました")
        except WebSocketDisconnect as exc:
            assert exc.code == 1008

    assert deepgram_client.connect_count == 0


def test_websocket_transcriptions_relays_messages_after_auth(monkeypatch) -> None:
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
    monkeypatch.setattr(
        "app.services.auth_service.get_default_auth_client",
        lambda: _StubAuthClient(),
    )

    with client.websocket_connect(
        "/api/transcriptions/ws?channels=2&language=ja&sample_rate=16000&endpointing=300",
        headers={"origin": DEFAULT_ORIGIN},
    ) as ws:
        ws.send_text(_auth_frame("jwt-ok"))
        auth_ok = json.loads(ws.receive_text())
        assert auth_ok["type"] == "AuthOk"
        ws.send_bytes(b"\x10\x00\x20\x00")
        received = ws.receive_text()
        assert json.loads(received) == json.loads(transcript_json)
        ws.send_text('{"type": "CloseStream"}')
        try:
            ws.receive_text()
            raise AssertionError("CloseStream 後に接続が閉じませんでした")
        except WebSocketDisconnect as exc:
            assert exc.code == 1000

    assert stub_client.recorded_params == {
        "channels": 2,
        "language": "ja",
        "sample_rate": 16000,
        "endpointing_ms": 300,
    }
    assert b"\x10\x00\x20\x00" in stream.sent_messages
    assert all(not (isinstance(m, str) and "Auth" in m) for m in stream.sent_messages)


def test_websocket_transcriptions_sends_error_event_when_deepgram_fails(monkeypatch) -> None:
    stub_client = _StubDeepgramClient(
        error=DeepgramClientError("Deepgram WebSocket 認証エラー", status_code=401)
    )
    monkeypatch.setattr(
        "app.services.transcription_service.DeepgramClient",
        lambda: stub_client,
    )
    monkeypatch.setattr(
        "app.services.auth_service.get_default_auth_client",
        lambda: _StubAuthClient(),
    )

    with client.websocket_connect(
        "/api/transcriptions/ws?channels=1", headers={"origin": DEFAULT_ORIGIN}
    ) as ws:
        ws.send_text(_auth_frame())
        received = json.loads(ws.receive_text())
        assert received == {
            "type": "Error",
            "code": "UPSTREAM_ERROR",
            "message": "Deepgram WebSocket 認証エラー",
        }


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
        client_ws = _StubClientWebSocket([_auth_frame(), '{"type":"CloseStream"}'])
        closes: list[int] = []

        async def close(code: int, reason: str) -> None:
            closes.append(code)

        await relay_deepgram_stream(
            client_ws,
            TranscriptionStreamConfig(),
            _StubDeepgramClient(stream),
            close,
            auth_client=_StubAuthClient(),
        )
        assert len(client_ws.sent_texts) == 2
        assert json.loads(client_ws.sent_texts[0])["type"] == "AuthOk"
        assert json.loads(client_ws.sent_texts[1])["is_final"] is True
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

        client_ws = _StubClientWebSocket([_auth_frame(), '{"type":"CloseStream"}'])
        closes: list[int] = []

        async def close(code: int, reason: str) -> None:
            closes.append(code)

        await relay_deepgram_stream(
            client_ws,
            TranscriptionStreamConfig(),
            _StubDeepgramClient(Stream()),
            close,
            auth_client=_StubAuthClient(),
        )
        assert cancelled.is_set()
        assert closes == [1011]
        assert json.loads(client_ws.sent_texts[0])["type"] == "AuthOk"
        assert json.loads(client_ws.sent_texts[1])["type"] == "Error"

    asyncio.run(scenario())
