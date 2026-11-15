from pydantic import BaseModel


class UserProfileResponse(BaseModel):
    """認証済みユーザーの表示用プロフィール情報。"""

    user_id: str
    masked_email: str | None = None
