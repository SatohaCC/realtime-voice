from typing import Annotated

from fastapi import Header, HTTPException

from app.clients.supabase_auth_client import AuthClientError
from app.schemas.auth import AuthenticatedUser
from app.services.auth_service import authenticate_access_token


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """Authorization Bearer ヘッダーから Supabase JWT を検証して認証済みユーザーを返す。"""
    if not authorization:
        raise HTTPException(status_code=401, detail="認証が必要です。")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Bearer トークンが必要です。")

    try:
        return await authenticate_access_token(token)
    except AuthClientError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
