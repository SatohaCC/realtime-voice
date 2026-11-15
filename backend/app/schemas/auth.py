from typing import Literal

from pydantic import BaseModel, Field


class AuthenticatedUser(BaseModel):
    """Supabase Auth JWT を検証して抽出した認証済みユーザー情報。"""

    user_id: str
    email: str | None = None
    role: str
    expires_at: int


class WsAuthFrame(BaseModel):
    """WebSocket 接続直後にクライアントが送信する認証フレーム。"""

    type: Literal["Auth"]
    access_token: str = Field(min_length=1)


class WsAuthOkEvent(BaseModel):
    """WebSocket 認証と Deepgram 接続の確立を通知するイベント。"""

    type: Literal["AuthOk"] = "AuthOk"
    expires_at: int
    session_expires_at: int
