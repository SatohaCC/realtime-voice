import json
from collections.abc import Sequence
from urllib.parse import urlparse

from pydantic import ValidationError

from app.clients.supabase_auth_client import AuthClientError, AuthClientProtocol, SupabaseAuthClient
from app.core.config import settings
from app.schemas.auth import AuthenticatedUser, WsAuthFrame

_cached_client_key: tuple[str, str] | None = None
_cached_client: SupabaseAuthClient | None = None


def get_default_auth_client() -> SupabaseAuthClient:
    """JWKS キャッシュを共有するため、設定単位で SupabaseAuthClient を再利用する。"""
    global _cached_client_key, _cached_client
    key = (settings.supabase_url, settings.supabase_jwt_audience)
    if _cached_client is None or _cached_client_key != key:
        _cached_client = SupabaseAuthClient(
            supabase_url=settings.supabase_url,
            audience=settings.supabase_jwt_audience,
        )
        _cached_client_key = key
    return _cached_client


def normalize_origin(raw: str | None) -> str | None:
    """Origin ヘッダーまたは設定文字列を `scheme://netloc` へ正規化する。"""
    if not raw:
        return None
    parsed = urlparse(raw.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def is_origin_allowed(
    origin: str | None,
    allowed_origins: Sequence[str] | None = None,
) -> bool:
    """WebSocket 接続元の Origin が許可リストに含まれるか検証する。"""
    normalized = normalize_origin(origin)
    if normalized is None:
        return False

    candidates = allowed_origins if allowed_origins is not None else settings.ws_allowed_origins
    normalized_allowlist = {
        item_norm for item in candidates if (item_norm := normalize_origin(item)) is not None
    }
    return normalized in normalized_allowlist


def parse_ws_auth_frame(payload: bytes | str | None, *, max_bytes: int | None = None) -> str:
    """WebSocket 初回認証フレームからアクセストークンを取り出し、不正形式を拒否する。"""
    if payload is None or isinstance(payload, bytes):
        raise AuthClientError(
            "接続直後に認証フレームを送信してください。",
            code="AUTH_REQUIRED",
            status_code=401,
        )

    limit = max_bytes if max_bytes is not None else settings.ws_auth_max_bytes
    if len(payload.encode("utf-8")) > limit:
        raise AuthClientError(
            "認証フレームのサイズが上限を超えています。",
            code="AUTH_FRAME_TOO_LARGE",
            status_code=401,
        )

    try:
        raw_json = json.loads(payload)
    except ValueError as exc:
        raise AuthClientError(
            "認証フレームの形式が不正です。",
            code="AUTH_FRAME_INVALID",
            status_code=401,
        ) from exc

    try:
        frame = WsAuthFrame.model_validate(raw_json)
    except ValidationError as exc:
        raise AuthClientError(
            "有効な Auth フレームが必要です。",
            code="AUTH_REQUIRED",
            status_code=401,
        ) from exc

    token = frame.access_token.strip()
    if not token:
        raise AuthClientError(
            "認証トークンが空です。",
            code="AUTH_INVALID_TOKEN",
            status_code=401,
        )
    return token


async def authenticate_access_token(
    token: str,
    *,
    client: AuthClientProtocol | None = None,
) -> AuthenticatedUser:
    """アクセストークンを検証し、認証済みユーザーを返す。"""
    resolved_client = client or get_default_auth_client()
    return await resolved_client.verify_access_token(token)
