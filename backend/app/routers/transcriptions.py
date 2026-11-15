from contextlib import suppress

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.schemas.transcription import TranscriptionStreamConfig
from app.services.auth_service import is_origin_allowed
from app.services.transcription_service import relay_deepgram_stream

router = APIRouter(prefix="/api/transcriptions", tags=["transcriptions"])


class _FastApiWebSocketAdapter:
    """FastAPI の WebSocket をサービス層のプロトコルへ適合させる薄いアダプタ。"""

    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket

    async def receive_message(self) -> bytes | str | None:
        try:
            message = await self._websocket.receive()
        except WebSocketDisconnect:
            return None
        if message.get("type") == "websocket.disconnect":
            return None
        if message.get("bytes") is not None:
            return bytes(message["bytes"])
        if message.get("text") is not None:
            return str(message["text"])
        return None

    async def send_text(self, text: str) -> None:
        await self._websocket.send_text(text)


@router.websocket("/ws")
async def transcribe_websocket(
    websocket: WebSocket,
    channels: int = Query(default=2, ge=1, le=2),
    language: str = Query(default="ja"),
    sample_rate: int = Query(default=16000, ge=8000, le=48000),
    endpointing: int = Query(default=300, ge=10, le=5000),
) -> None:
    """Origin と初回 Auth フレームを検証し、PCM 音声を Deepgram へ双方向中継する。"""
    if not is_origin_allowed(websocket.headers.get("origin")):
        with suppress(Exception):
            await websocket.close(code=1008, reason="origin not allowed")
        return

    await websocket.accept()
    config = TranscriptionStreamConfig(
        channels=channels,
        language=language,
        sample_rate=sample_rate,
        endpointing_ms=endpointing,
    )
    adapter = _FastApiWebSocketAdapter(websocket)

    async def _close_connection(code: int, reason: str) -> None:
        with suppress(Exception):
            await websocket.close(code=code, reason=reason)

    await relay_deepgram_stream(
        client_ws=adapter,
        config=config,
        on_close=_close_connection,
    )
