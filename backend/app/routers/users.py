from typing import Annotated

from fastapi import APIRouter, Depends

from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.user import UserProfileResponse
from app.services.user_service import build_user_profile

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserProfileResponse)
async def get_my_profile(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> UserProfileResponse:
    """ログイン中ユーザーの表示用プロフィール情報（マスク済みメールアドレスを含む）を返す。"""
    return build_user_profile(current_user)
