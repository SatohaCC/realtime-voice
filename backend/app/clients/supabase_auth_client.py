import asyncio
from typing import Any, Protocol

import jwt

from app.core.config import settings
from app.schemas.auth import AuthenticatedUser

ALLOWED_JWT_ALGORITHMS = ("ES256", "RS256")


class AuthClientError(Exception):
    """認証トークン検証または認証基盤通信時のエラー。"""

    def __init__(self, message: str, *, code: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class AuthClientProtocol(Protocol):
    """テスト差し替え用の認証クライアント契約。"""

    async def verify_access_token(self, token: str) -> AuthenticatedUser: ...


class SupabaseAuthClient:
    """Supabase Auth が発行した JWT を JWKS（ES256/RS256）で検証するアダプタ。"""

    def __init__(
        self,
        *,
        supabase_url: str | None = None,
        audience: str | None = None,
        jwks_timeout_seconds: float | None = None,
        overall_timeout_seconds: float | None = None,
        cache_ttl_seconds: int | None = None,
        jwk_client: Any | None = None,
    ) -> None:
        resolved_url = (
            (supabase_url if supabase_url is not None else settings.supabase_url)
            .strip()
            .rstrip("/")
        )
        self._supabase_url = resolved_url
        self._audience = (
            audience if audience is not None else settings.supabase_jwt_audience
        ).strip() or "authenticated"
        self._issuer = f"{resolved_url}/auth/v1" if resolved_url else ""
        self._jwks_url = f"{self._issuer}/.well-known/jwks.json" if resolved_url else ""
        self._jwks_timeout_seconds = (
            jwks_timeout_seconds
            if jwks_timeout_seconds is not None
            else settings.supabase_jwks_timeout_seconds
        )
        self._overall_timeout_seconds = (
            overall_timeout_seconds
            if overall_timeout_seconds is not None
            else settings.ws_auth_overall_timeout_seconds
        )
        self._cache_ttl_seconds = (
            cache_ttl_seconds
            if cache_ttl_seconds is not None
            else settings.supabase_jwks_cache_ttl_seconds
        )
        self._jwk_client: Any | None = jwk_client

    def _get_jwk_client(self) -> Any:
        if self._jwk_client is None:
            self._jwk_client = jwt.PyJWKClient(
                self._jwks_url,
                cache_keys=False,
                cache_jwk_set=True,
                lifespan=self._cache_ttl_seconds,
                timeout=self._jwks_timeout_seconds,
            )
        return self._jwk_client

    def _decode_token_sync(self, token: str) -> AuthenticatedUser:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthClientError(
                "認証トークンの形式が不正です。", code="AUTH_INVALID_TOKEN", status_code=401
            ) from exc

        alg = header.get("alg")
        if not isinstance(alg, str) or alg not in ALLOWED_JWT_ALGORITHMS:
            raise AuthClientError(
                "許可されていない署名方式です。", code="AUTH_UNSUPPORTED_ALG", status_code=401
            )

        jwk_client = self._get_jwk_client()
        try:
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            if signing_key.algorithm_name != alg:
                raise jwt.InvalidAlgorithmError("署名方式が検証鍵と一致しません。")
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=list(ALLOWED_JWT_ALGORITHMS),
                issuer=self._issuer,
                audience=self._audience,
                options={
                    "require": ["exp", "iss", "aud", "sub"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_aud": True,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise AuthClientError(
                "認証の有効期限が切れています。再ログインしてください。",
                code="AUTH_EXPIRED",
                status_code=401,
            ) from exc
        except jwt.PyJWKClientConnectionError as exc:
            raise AuthClientError(
                "認証基盤との通信に失敗しました。時間をおいて再試行してください。",
                code="AUTH_UNAVAILABLE",
                status_code=503,
            ) from exc
        except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
            raise AuthClientError(
                "認証トークンを検証できませんでした。", code="AUTH_INVALID_TOKEN", status_code=401
            ) from exc

        sub = payload.get("sub")
        if not isinstance(sub, str) or not sub.strip():
            raise AuthClientError(
                "認証トークンに必要な識別子がありません。",
                code="AUTH_INVALID_CLAIMS",
                status_code=401,
            )

        role = payload.get("role")
        if role != "authenticated" or payload.get("is_anonymous") is True:
            raise AuthClientError(
                "認証済みユーザーの権限がありません。",
                code="AUTH_FORBIDDEN",
                status_code=403,
            )

        exp = payload.get("exp")
        if not isinstance(exp, int | float):
            raise AuthClientError(
                "認証トークンの有効期限が不正です。",
                code="AUTH_INVALID_CLAIMS",
                status_code=401,
            )

        raw_email = payload.get("email")
        email = raw_email.strip() if isinstance(raw_email, str) and raw_email.strip() else None

        return AuthenticatedUser(
            user_id=sub.strip(),
            email=email,
            role=role,
            expires_at=int(exp),
        )

    async def verify_access_token(self, token: str) -> AuthenticatedUser:
        """Supabase JWT を非同期スレッドで署名・claim 検証してユーザー情報を返す。"""
        if not self._supabase_url:
            raise AuthClientError(
                "認証設定が構成されていません。",
                code="AUTH_NOT_CONFIGURED",
                status_code=503,
            )

        cleaned = token.strip()
        if not cleaned:
            raise AuthClientError(
                "認証トークンが空です。", code="AUTH_INVALID_TOKEN", status_code=401
            )

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._decode_token_sync, cleaned),
                timeout=self._overall_timeout_seconds,
            )
        except TimeoutError as exc:
            raise AuthClientError(
                "認証検証がタイムアウトしました。時間をおいて再試行してください。",
                code="AUTH_TIMEOUT",
                status_code=503,
            ) from exc
