from fastapi.testclient import TestClient

from app.main import app as backend_app
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.services.user_service import mask_email


def test_mask_email_variants() -> None:
    """メールアドレスの各形式を長さ情報も含めず安全に伏せ字化する。"""
    assert mask_email("pharmacist@example.com") == "p***@e***.com"
    assert mask_email("  ab@clinic.co.jp ") == "a***@c***.co.jp"
    assert mask_email("a@b.jp") == "*@*.jp"
    assert mask_email("local@localhost") == "l***@l***"
    assert mask_email("not-an-email") == "***"
    assert mask_email("invalid@.com") == "i***@***"
    assert mask_email("") is None
    assert mask_email("   ") is None
    assert mask_email(None) is None


def test_get_my_profile_requires_authentication() -> None:
    """未認証で /api/users/me にアクセスすると 401 を返す。"""
    client = TestClient(backend_app)
    response = client.get("/api/users/me")
    assert response.status_code == 401


def test_get_my_profile_returns_masked_email() -> None:
    """認証済みユーザーにはマスク済みメールアドレスを返し、生のメールアドレスを含めない。"""

    async def _override_user() -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id="user-123",
            email="pharmacist.taro@pharmacy.example.jp",
            role="authenticated",
            expires_at=9_999_999_999,
        )

    backend_app.dependency_overrides[get_current_user] = _override_user
    try:
        client = TestClient(backend_app)
        response = client.get("/api/users/me")
    finally:
        backend_app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "user-123",
        "masked_email": "p***@p***.example.jp",
    }
    assert "pharmacist.taro" not in response.text


def test_get_my_profile_handles_missing_email() -> None:
    """メールアドレスを持たないユーザーには masked_email=null を返す。"""

    async def _override_user() -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id="user-456",
            email=None,
            role="authenticated",
            expires_at=9_999_999_999,
        )

    backend_app.dependency_overrides[get_current_user] = _override_user
    try:
        client = TestClient(backend_app)
        response = client.get("/api/users/me")
    finally:
        backend_app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "user_id": "user-456",
        "masked_email": None,
    }
