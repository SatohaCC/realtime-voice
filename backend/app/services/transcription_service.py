import asyncio
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Protocol

from app.clients.deepgram_client import (
    DeepgramClient,
    DeepgramClientError,
    DeepgramClientProtocol,
    DeepgramStreamProtocol,
)
from app.schemas.transcription import TranscriptionErrorEvent, TranscriptionStreamConfig

FINAL_RESULTS_TIMEOUT_SECONDS = 5


class ClientWebSocketDisconnected(Exception):
    """ブラウザ側 WebSocket が切断されたことを表す内部例外。"""


class ClientWebSocketProtocol(Protocol):
    """FastAPI 依存を隔離するためのクライアント側 WebSocket 契約。"""

    async def receive_message(self) -> bytes | str | None:
        """受信データを返す。切断時は None を返す。"""
        ...

    async def send_text(self, text: str) -> None: ...


async def _forward_client_to_deepgram(
    client_ws: ClientWebSocketProtocol,
    deepgram_ws: DeepgramStreamProtocol,
) -> bool:
    while True:
        payload = await client_ws.receive_message()
        if payload is None:
            # 既に切断されている場合は CloseStream 送信を無視する
            with suppress(Exception):
                await deepgram_ws.send('{"type": "CloseStream"}')
            return False
        await deepgram_ws.send(payload)
        if isinstance(payload, str):
            try:
                control = json.loads(payload)
            except ValueError:
                continue
            if isinstance(control, dict) and control.get("type") == "CloseStream":
                return True


async def _forward_deepgram_to_client(
    deepgram_ws: DeepgramStreamProtocol,
    client_ws: ClientWebSocketProtocol,
) -> None:
    while True:
        try:
            message = await deepgram_ws.recv()
        except EOFError:
            return
        except Exception as exc:
            raise DeepgramClientError("文字起こしストリームの受信に失敗しました。") from exc
        text = message.decode("utf-8", errors="ignore") if isinstance(message, bytes) else message
        await client_ws.send_text(text)


async def relay_deepgram_stream(
    client_ws: ClientWebSocketProtocol,
    config: TranscriptionStreamConfig,
    client: DeepgramClientProtocol | None = None,
    on_close: Callable[[int, str], Awaitable[None]] | None = None,
) -> None:
    """ブラウザ WebSocket と Deepgram WebSocket の間で音声と文字起こし結果を双方向中継する。"""
    resolved_client = client or DeepgramClient()

    try:
        async with resolved_client.connect_listen_stream(
            channels=config.channels,
            language=config.language,
            sample_rate=config.sample_rate,
            endpointing_ms=config.endpointing_ms,
        ) as deepgram_ws:
            client_task = asyncio.create_task(_forward_client_to_deepgram(client_ws, deepgram_ws))
            deepgram_task = asyncio.create_task(_forward_deepgram_to_client(deepgram_ws, client_ws))

            client_disconnected = False
            try:
                done, _ = await asyncio.wait(
                    {client_task, deepgram_task}, return_when=asyncio.FIRST_COMPLETED
                )
                if client_task in done:
                    graceful = client_task.result()
                    client_disconnected = not graceful
                    if graceful:
                        try:
                            await asyncio.wait_for(
                                asyncio.shield(deepgram_task), timeout=FINAL_RESULTS_TIMEOUT_SECONDS
                            )
                        except TimeoutError as exc:
                            raise DeepgramClientError(
                                "文字起こしの最終結果の待機がタイムアウトしました。"
                            ) from exc
                else:
                    deepgram_task.result()
                if not client_disconnected and on_close is not None:
                    await on_close(1000, "stream complete")
            finally:
                for task in (client_task, deepgram_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(client_task, deepgram_task, return_exceptions=True)
    except DeepgramClientError as exc:
        error_event = TranscriptionErrorEvent(message=str(exc))
        with suppress(Exception):
            await client_ws.send_text(error_event.model_dump_json())
        if on_close is not None:
            await on_close(1011, "deepgram error")
