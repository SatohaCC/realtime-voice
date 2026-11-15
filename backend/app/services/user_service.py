from app.schemas.auth import AuthenticatedUser
from app.schemas.user import UserProfileResponse


def _mask_label(label: str) -> str:
    """識別子ラベルの先頭 1 文字だけを残して固定長の伏せ字を返す。"""
    if len(label) <= 1:
        return "*"
    return f"{label[0]}***"


def mask_email(email: str | None) -> str | None:
    """メールアドレスのローカル部とドメイン本体を伏せ字化して返す。"""
    if email is None:
        return None

    cleaned = email.strip()
    if not cleaned:
        return None

    local, separator, domain = cleaned.partition("@")
    if not separator or not local or not domain:
        return "***"

    domain_parts = domain.split(".")
    if any(not part for part in domain_parts):
        return f"{_mask_label(local)}@***"

    if len(domain_parts) == 1:
        masked_domain = _mask_label(domain_parts[0])
    else:
        masked_domain = f"{_mask_label(domain_parts[0])}.{'.'.join(domain_parts[1:])}"

    return f"{_mask_label(local)}@{masked_domain}"


def build_user_profile(user: AuthenticatedUser) -> UserProfileResponse:
    """認証済みユーザーからメールアドレスをマスクした表示用プロフィールを構築する。"""
    return UserProfileResponse(
        user_id=user.user_id,
        masked_email=mask_email(user.email),
    )
