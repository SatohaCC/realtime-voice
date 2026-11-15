import asyncio
import base64
import io
import json
import time
from types import SimpleNamespace
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.clients.supabase_auth_client import AuthClientError, SupabaseAuthClient
from app.main import app as backend_app
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.services.auth_service import is_origin_allowed, parse_ws_auth_frame

SUPABASE_TEST_URL = "https://example.supabase.co"
SUPABASE_ISSUER = f"{SUPABASE_TEST_URL}/auth/v1"


def _generate_ec_keypair(kid: str) -> tuple[ec.EllipticCurvePrivateKey, dict[str, Any]]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key()))
    public_jwk["kid"] = kid
    public_jwk["alg"] = "ES256"
    public_jwk["use"] = "sig"
    return private_key, public_jwk


class _StubJwkClient:
    """kid に応じた公開鍵を返し、必要なら遅延や接続エラーを再現するテスト用 JWKS クライアント。"""

    def __init__(
        self,
        jwks_by_kid: dict[str, dict[str, Any]],
        *,
        delay_seconds: float = 0.0,
        error: Exception | None = None,
    ) -> None:
        self._jwks_by_kid = jwks_by_kid
        self._delay_seconds = delay_seconds
        self._error = error

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        if self._delay_seconds > 0:
            time.sleep(self._delay_seconds)
        if self._error is not None:
            raise self._error
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not isinstance(kid, str) or kid not in self._jwks_by_kid:
            raise jwt.PyJWKClientError("Unable to find a signing key")
        return jwt.PyJWK.from_dict(self._jwks_by_kid[kid])


def _issue_es256_token(
    private_key: ec.EllipticCurvePrivateKey,
    *,
    kid: str = "key-1",
    sub: str | None = "user-123",
    role: str | None = "authenticated",
    iss: str = SUPABASE_ISSUER,
    aud: str = "authenticated",
    exp_offset: int = 300,
    email: str | None = "doctor@example.com",
    is_anonymous: bool = False,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "iss": iss,
        "aud": aud,
        "exp": now + exp_offset,
        "iat": now,
    }
    if sub is not None:
        payload["sub"] = sub
    if role is not None:
        payload["role"] = role
    if email is not None:
        payload["email"] = email
    if is_anonymous:
        payload["is_anonymous"] = True
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": kid})


def _expect_auth_error(coro: Any, expected_code: str) -> AuthClientError:
    try:
        asyncio.run(coro)
        raise AssertionError(f"AuthClientError ({expected_code}) が発生しませんでした")
    except AuthClientError as exc:
        assert exc.code == expected_code
        return exc


def test_verify_valid_es256_token_and_key_rotation() -> None:
    priv1, jwk1 = _generate_ec_keypair("key-1")
    priv2, jwk2 = _generate_ec_keypair("key-2")
    client = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL,
        jwk_client=_StubJwkClient({"key-1": jwk1, "key-2": jwk2}),
    )

    user1 = asyncio.run(client.verify_access_token(_issue_es256_token(priv1, kid="key-1")))
    assert user1.user_id == "user-123"
    assert user1.email == "doctor@example.com"
    assert user1.role == "authenticated"

    # email が無いトークンでも sub で識別できる
    user2 = asyncio.run(
        client.verify_access_token(
            _issue_es256_token(priv2, kid="key-2", sub="user-456", email=None)
        )
    )
    assert user2.user_id == "user-456"
    assert user2.email is None


def test_jwks_cache_expires_and_rejects_removed_keys(monkeypatch) -> None:
    private_key, jwk = _generate_ec_keypair("key-1")
    next_private_key, next_jwk = _generate_ec_keypair("key-2")
    published_keys = [jwk]
    fetch_count = 0

    def fetch(*args: Any, **kwargs: Any) -> io.BytesIO:
        nonlocal fetch_count
        fetch_count += 1
        return io.BytesIO(json.dumps({"keys": published_keys}).encode())

    monkeypatch.setattr(
        "jwt.jwks_client.urllib.request.build_opener",
        lambda *args: SimpleNamespace(open=fetch),
    )
    client = SupabaseAuthClient(supabase_url=SUPABASE_TEST_URL, cache_ttl_seconds=300)
    old_token = _issue_es256_token(private_key)
    assert asyncio.run(client.verify_access_token(old_token)).user_id == "user-123"
    assert asyncio.run(client.verify_access_token(old_token)).user_id == "user-123"
    assert fetch_count == 1

    published_keys[:] = [next_jwk]
    expired_time = time.monotonic() + 301
    monkeypatch.setattr("jwt.jwk_set_cache.time", SimpleNamespace(monotonic=lambda: expired_time))
    monkeypatch.setattr("jwt.api_jwk.time", SimpleNamespace(monotonic=lambda: expired_time))
    _expect_auth_error(client.verify_access_token(old_token), "AUTH_INVALID_TOKEN")
    assert fetch_count == 2
    assert (
        asyncio.run(
            client.verify_access_token(_issue_es256_token(next_private_key, kid="key-2"))
        ).user_id
        == "user-123"
    )
    assert fetch_count == 2


@pytest.mark.parametrize("key_algorithm", ["ES256", "RS256"])
def test_verify_rejects_algorithm_key_mismatch_and_accepts_matching_key(
    key_algorithm: str, monkeypatch
) -> None:
    private_key: ec.EllipticCurvePrivateKey | rsa.RSAPrivateKey
    payload = {
        "sub": "user-123",
        "role": "authenticated",
        "iss": SUPABASE_ISSUER,
        "aud": "authenticated",
        "exp": int(time.time()) + 300,
    }
    if key_algorithm == "ES256":
        private_key, jwk = _generate_ec_keypair("key-1")
    else:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
        jwk.update(kid="key-1", alg="RS256", use="sig")
    client = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL, jwk_client=_StubJwkClient({"key-1": jwk})
    )
    token = jwt.encode(payload, private_key, algorithm=key_algorithm, headers={"kid": "key-1"})
    assert asyncio.run(client.verify_access_token(token)).user_id == "user-123"

    parts = token.split(".")
    other_algorithm = "RS256" if key_algorithm == "ES256" else "ES256"
    parts[0] = (
        base64.urlsafe_b64encode(json.dumps({"alg": other_algorithm, "kid": "key-1"}).encode())
        .rstrip(b"=")
        .decode()
    )
    invalid_token = ".".join(parts)
    _expect_auth_error(client.verify_access_token(invalid_token), "AUTH_INVALID_TOKEN")

    monkeypatch.setattr("app.services.auth_service.get_default_auth_client", lambda: client)

    def unexpected_deepgram() -> None:
        raise AssertionError("不正な認証で Deepgram に接続しました")

    monkeypatch.setattr("app.services.transcription_service.DeepgramClient", unexpected_deepgram)
    with TestClient(backend_app).websocket_connect(
        "/api/transcriptions/ws", headers={"origin": "http://localhost:3000"}
    ) as ws:
        ws.send_text(json.dumps({"type": "Auth", "access_token": invalid_token}))
        error = ws.receive_json()
        assert error["type"] == "Error"
        assert error["code"] == "AUTH_INVALID_TOKEN"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1008


def test_verify_rejects_expired_tampered_wrong_claims_and_disallowed_alg() -> None:
    priv, jwk = _generate_ec_keypair("key-1")
    other_priv, _ = _generate_ec_keypair("key-1")
    client = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL,
        jwk_client=_StubJwkClient({"key-1": jwk}),
    )

    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, exp_offset=-10)),
        "AUTH_EXPIRED",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(other_priv)),
        "AUTH_INVALID_TOKEN",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, iss="https://evil.example/auth/v1")),
        "AUTH_INVALID_TOKEN",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, aud="other-aud")),
        "AUTH_INVALID_TOKEN",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, kid="unknown-kid")),
        "AUTH_INVALID_TOKEN",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, sub="  ")),
        "AUTH_INVALID_CLAIMS",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, role="anon")),
        "AUTH_FORBIDDEN",
    )
    _expect_auth_error(
        client.verify_access_token(_issue_es256_token(priv, is_anonymous=True)),
        "AUTH_FORBIDDEN",
    )

    hs256_token = jwt.encode(
        {
            "sub": "user-123",
            "role": "authenticated",
            "iss": SUPABASE_ISSUER,
            "aud": "authenticated",
            "exp": int(time.time()) + 300,
        },
        "weak-shared-secret-value-over-32-bytes",
        algorithm="HS256",
    )
    _expect_auth_error(client.verify_access_token(hs256_token), "AUTH_UNSUPPORTED_ALG")


def test_verify_handles_missing_config_jwks_failure_timeout_and_non_blocking_loop() -> None:
    unconfigured = SupabaseAuthClient(supabase_url="")
    _expect_auth_error(unconfigured.verify_access_token("dummy"), "AUTH_NOT_CONFIGURED")

    priv, jwk = _generate_ec_keypair("key-1")
    token = _issue_es256_token(priv)

    unavailable = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL,
        jwk_client=_StubJwkClient({}, error=jwt.PyJWKClientConnectionError("network error")),
    )
    _expect_auth_error(unavailable.verify_access_token(token), "AUTH_UNAVAILABLE")

    slow_ok = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL,
        overall_timeout_seconds=1.0,
        jwk_client=_StubJwkClient({"key-1": jwk}, delay_seconds=0.08),
    )

    async def concurrent_check() -> tuple[AuthenticatedUser, float]:
        t0 = time.monotonic()
        verify_task = asyncio.create_task(slow_ok.verify_access_token(token))
        await asyncio.sleep(0.01)
        tick_elapsed = time.monotonic() - t0
        user = await verify_task
        return user, tick_elapsed

    user, tick_elapsed = asyncio.run(concurrent_check())
    assert user.user_id == "user-123"
    # 同期的な JWKS 取得中でもイベントループがブロックされないことを確認する
    assert tick_elapsed < 0.06

    timed_out = SupabaseAuthClient(
        supabase_url=SUPABASE_TEST_URL,
        overall_timeout_seconds=0.02,
        jwk_client=_StubJwkClient({"key-1": jwk}, delay_seconds=0.1),
    )
    _expect_auth_error(timed_out.verify_access_token(token), "AUTH_TIMEOUT")


def test_origin_allowlist_and_ws_auth_frame_parsing() -> None:
    allowlist = ["http://localhost:3000", "https://app.example.com"]
    assert is_origin_allowed("http://localhost:3000", allowlist) is True
    assert is_origin_allowed("https://app.example.com/", allowlist) is True
    assert is_origin_allowed("https://evil.example.com", allowlist) is False
    assert is_origin_allowed(None, allowlist) is False

    assert parse_ws_auth_frame(json.dumps({"type": "Auth", "access_token": "abc.def.ghi"})) == (
        "abc.def.ghi"
    )
    for invalid in (
        None,
        b"\x00\x01",
        "not-json",
        json.dumps({"type": "KeepAlive"}),
        json.dumps({"type": "Auth", "access_token": "   "}),
    ):
        try:
            parse_ws_auth_frame(invalid)
            raise AssertionError("不正な認証フレームが通過しました")
        except AuthClientError:
            pass

    oversized = json.dumps({"type": "Auth", "access_token": "a" * 20000})
    try:
        parse_ws_auth_frame(oversized, max_bytes=16 * 1024)
        raise AssertionError("上限超過の認証フレームが通過しました")
    except AuthClientError as exc:
        assert exc.code == "AUTH_FRAME_TOO_LARGE"


def test_get_current_user_dependency(monkeypatch) -> None:
    app = FastAPI()

    @app.get("/protected")
    async def protected_route(
        user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    ) -> dict[str, str]:
        return {"user_id": user.user_id}

    test_client = TestClient(app)

    assert test_client.get("/protected").status_code == 401
    assert test_client.get("/protected", headers={"Authorization": "Basic abc"}).status_code == 401

    async def _stub_verify(token: str, *, client: Any = None) -> AuthenticatedUser:
        assert token == "good-token"
        return AuthenticatedUser(user_id="user-999", role="authenticated", expires_at=9999999999)

    monkeypatch.setattr("app.routers.dependencies.authenticate_access_token", _stub_verify)
    res = test_client.get("/protected", headers={"Authorization": "Bearer good-token"})
    assert res.status_code == 200
    assert res.json() == {"user_id": "user-999"}
