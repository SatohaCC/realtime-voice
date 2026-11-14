import os
from dataclasses import dataclass, field
from pathlib import Path


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


def _parse_origins(raw: str | None) -> list[str]:
    if not raw:
        return ["http://localhost:3000", "http://127.0.0.1:3000"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


_load_dotenv_files()


@dataclass(frozen=True)
class Settings:
    """環境変数から読み込むアプリケーション設定。"""

    app_name: str = "Realtime Voice API"
    service_name: str = "realtime-voice-backend"
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(os.getenv("CORS_ORIGINS"))
    )
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


settings = Settings()
