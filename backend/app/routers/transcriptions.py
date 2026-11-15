from contextlib import suppress
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.speaker import SetConversationSegmentEnabledResponse, SetSegmentEnabledFrame
from app.schemas.transcription import TranscriptionStreamConfig
from app.services.auth_service import is_origin_allowed
from app.services.soap_stream_service import (
    set_conversation_segment_enabled,
    stream_conversation_segment_enabled,
)
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
    soap: bool = Query(default=False),
    conversation_id: str | None = Query(default=None),
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
        enable_soap=soap,
        conversation_id=conversation_id,
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


@router.patch(
    "/conversations/{conversation_id}/segments",
    response_model=SetConversationSegmentEnabledResponse,
)
async def update_conversation_segment_enabled(
    conversation_id: str,
    frame: SetSegmentEnabledFrame,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    stream: bool = False,
) -> SetConversationSegmentEnabledResponse | StreamingResponse:
    """原文を保持して無効化・再有効化し、SOAP再生成結果を返す。"""
    if stream:
        updates = stream_conversation_segment_enabled(
            user_id=current_user.user_id,
            conversation_id=conversation_id,
            stream_id=frame.stream_id,
            segment_id=frame.segment_id,
            enabled=frame.enabled,
        )
        try:
            first = await anext(updates)
        except StopAsyncIteration as exc:
            raise HTTPException(status_code=404, detail="対象の確定発話が見つかりません。") from exc

        async def body():
            try:
                yield first.model_dump_json() + "\n"
                async for update in updates:
                    yield update.model_dump_json() + "\n"
            finally:
                await updates.aclose()

        return StreamingResponse(
            body(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            },
        )
    result = await set_conversation_segment_enabled(
        user_id=current_user.user_id,
        conversation_id=conversation_id,
        stream_id=frame.stream_id,
        segment_id=frame.segment_id,
        enabled=frame.enabled,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="対象の確定発話が見つかりません。")
    updated, outcome, record = result
    return SetConversationSegmentEnabledResponse(
        conversation_id=conversation_id,
        segment=updated,
        soap=outcome.soap,
        changed_item_ids=outcome.changed_item_ids,
        retracted_item_ids=outcome.retracted_item_ids,
        soap_status=record.soap_status,
        has_unapplied_transcript=record.has_unapplied_transcript,
    )
