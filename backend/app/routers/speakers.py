import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.config import settings
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.speaker import SpeakerEnrollmentResponse
from app.services.speaker_service import SpeakerEnrollmentError, enroll_pharmacist_pcm16

router = APIRouter(prefix="/api/speakers", tags=["speakers"])


@router.post("/enroll", response_model=SpeakerEnrollmentResponse)
async def enroll_speaker(
    request: Request,
    _: Annotated[AuthenticatedUser, Depends(get_current_user)],
    sample_rate: int = Query(default=16000, ge=8000, le=48000),
    sample_frames: Annotated[list[int] | None, Query(max_length=3)] = None,
) -> SpeakerEnrollmentResponse:
    """薬剤師の事前登録音声（モノラル 16bit PCM）から話者特徴ベクトルを抽出し、永続化せず返す。"""
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Content-Length が不正です。") from exc
        if declared_size > settings.speaker_enrollment_max_bytes:
            raise HTTPException(
                status_code=413,
                detail="登録音声がサイズ上限を超えています。録音設定を確認してください。",
            )

    pcm16_bytes = await request.body()
    try:
        return await asyncio.to_thread(
            enroll_pharmacist_pcm16,
            pcm16_bytes,
            sample_rate=sample_rate,
            sample_frames=sample_frames,
        )
    except SpeakerEnrollmentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
