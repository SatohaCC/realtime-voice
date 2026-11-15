import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse


def _load_dotenv_files() -> None:
    """開発時にルートまたは backend 配下の .env から未設定の環境変数を読み込む。"""
    backend_dir = Path(__file__).resolve().parents[2]
    repo_root = backend_dir.parent
    for env_path in (repo_root / ".env", backend_dir / ".env"):
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key:
                continue
            cleaned = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, cleaned)


def _normalize_origin(raw: str) -> str | None:
    """Origin URL を `scheme://netloc` 形式に正規化する。"""
    parsed = urlparse(raw.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _parse_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["http://localhost:3000", "http://127.0.0.1:3000"]
    origins: list[str] = []
    for item in raw.split(","):
        normalized = _normalize_origin(item)
        if normalized and normalized not in origins:
            origins.append(normalized)
    return origins


def _parse_ws_allowed_origins() -> list[str]:
    base_raw = os.getenv("WS_ALLOWED_ORIGINS") or os.getenv("CORS_ORIGINS")
    origins = _parse_origins(base_raw)
    app_public_url = os.getenv("APP_PUBLIC_URL")
    if app_public_url:
        normalized = _normalize_origin(app_public_url)
        if normalized and normalized not in origins:
            origins.append(normalized)
    return origins


def _parse_positive_int(raw: str | None, default: int) -> int:
    if not raw:
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value > 0 else default


_load_dotenv_files()


@dataclass(frozen=True)
class Settings:
    """環境変数から読み込むアプリケーション設定。"""

    app_name: str = "Realtime Voice API"
    service_name: str = "realtime-voice-backend"
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(os.getenv("CORS_ORIGINS"))
    )
    ws_allowed_origins: list[str] = field(default_factory=_parse_ws_allowed_origins)
    deepgram_api_key: str = field(
        default_factory=lambda: (
            os.getenv("DEEPGRAM_KEY") or os.getenv("DEEPGRAM_API_KEY") or ""
        ).strip()
    )
    deepgram_base_url: str = field(
        default_factory=lambda: os.getenv("DEEPGRAM_BASE_URL", "https://api.deepgram.com").rstrip(
            "/"
        )
    )
    deepgram_token_ttl_seconds: int = 30
    supabase_url: str = field(
        default_factory=lambda: os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    )
    supabase_jwt_audience: str = field(
        default_factory=lambda: (
            os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated").strip() or "authenticated"
        )
    )
    supabase_jwks_timeout_seconds: float = 3.0
    supabase_jwks_cache_ttl_seconds: int = 300
    ws_auth_timeout_seconds: float = 5.0
    ws_auth_overall_timeout_seconds: float = 5.0
    ws_auth_max_bytes: int = 16 * 1024
    transcription_max_session_seconds: int = field(
        default_factory=lambda: _parse_positive_int(
            os.getenv("TRANSCRIPTION_MAX_SESSION_SECONDS"), default=240
        )
    )


settings = Settings()
