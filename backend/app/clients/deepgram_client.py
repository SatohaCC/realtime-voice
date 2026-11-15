from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol
from urllib.parse import urlencode

import websockets
from websockets.asyncio.client import ClientConnection
from websockets.exceptions import ConnectionClosedOK, InvalidStatus, WebSocketException

from app.core.config import settings


class DeepgramClientError(Exception):
    """Deepgram 接続時のエラー。"""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class DeepgramStreamProtocol(Protocol):
    """テスト差し替え用の Deepgram WebSocket ストリーム契約。"""

    async def send(self, message: bytes | str) -> None: ...

    async def recv(self) -> bytes | str: ...

    async def close(self) -> None: ...


class DeepgramClientProtocol(Protocol):
    """テスト差し替え用の Deepgram クライアント契約。"""

    @asynccontextmanager
    def connect_listen_stream(
        self,
        *,
        channels: int = 2,
        language: str = "ja",
        sample_rate: int = 16000,
        endpointing_ms: int = 300,
    ) -> AsyncIterator[DeepgramStreamProtocol]: ...


class _DeepgramStream:
    """SDKの正常終了をサービス層共通のEOFへ変換する。"""

    def __init__(self, connection: ClientConnection) -> None:
        self._connection = connection

    async def send(self, message: bytes | str) -> None:
        await self._connection.send(message)

    async def recv(self) -> bytes | str:
        try:
            return await self._connection.recv()
        except ConnectionClosedOK as exc:
            raise EOFError("stream complete") from exc

    async def close(self) -> None:
        await self._connection.close()


def build_deepgram_listen_url(
    *,
    channels: int = 2,
    language: str = "ja",
    sample_rate: int = 16000,
    endpointing_ms: int = 300,
) -> str:
    """Deepgram Live Streaming WebSocket の接続先 URL を組み立てる。"""
    params: dict[str, str] = {
        "model": "nova-3",
        "language": language,
        "encoding": "linear16",
        "sample_rate": str(sample_rate),
        "channels": str(channels),
        "interim_results": "true",
        "smart_format": "true",
        "endpointing": str(endpointing_ms),
    }
    if channels == 2:
        params["multichannel"] = "true"

    ws_base = settings.deepgram_base_url.replace("https://", "wss://").replace("http://", "ws://")
    return f"{ws_base}/v1/listen?{urlencode(params)}"


class DeepgramClient:
    """Deepgram WebSocket API と通信するアダプタ。"""

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = (api_key if api_key is not None else settings.deepgram_api_key).strip()

    @asynccontextmanager
    async def connect_listen_stream(
        self,
        *,
        channels: int = 2,
        language: str = "ja",
        sample_rate: int = 16000,
        endpointing_ms: int = 300,
    ) -> AsyncIterator[DeepgramStreamProtocol]:
        """Deepgram Live Streaming WebSocket へ接続する。"""
        if not self._api_key:
            raise DeepgramClientError("DEEPGRAM_KEY が設定されていません。", status_code=503)

        url = build_deepgram_listen_url(
            channels=channels,
            language=language,
            sample_rate=sample_rate,
            endpointing_ms=endpointing_ms,
        )

        try:
            async with websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {self._api_key}"},
                open_timeout=10,
                ping_interval=20,
                ping_timeout=20,
            ) as ws:
                yield _DeepgramStream(ws)
        except InvalidStatus as exc:
            status_code = exc.response.status_code
            raise DeepgramClientError(
                f"Deepgram WebSocket 接続が拒否されました (HTTP {status_code})。",
                status_code=502,
            ) from exc
        except (WebSocketException, OSError, TimeoutError) as exc:
            raise DeepgramClientError(
                f"Deepgram WebSocket への接続に失敗しました: {exc}",
                status_code=502,
            ) from exc
