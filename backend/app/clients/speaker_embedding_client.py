from __future__ import annotations

import threading
from pathlib import Path
from typing import Protocol

import numpy as np

from app.core.config import settings


class SpeakerEmbeddingClientError(Exception):
    """話者埋め込みクライアントの初期化・推論エラー。"""

    def __init__(self, message: str, *, code: str = "SPEAKER_CLIENT_ERROR") -> None:
        super().__init__(message)
        self.code = code


class SpeakerEmbeddingClientProtocol(Protocol):
    """話者埋め込み抽出クライアントの契約（sherpa-onnx 依存を隔離する）。"""

    @property
    def model_id(self) -> str: ...

    @property
    def embedding_dim(self) -> int: ...

    def extract_embedding_from_pcm16(
        self,
        pcm16_bytes: bytes,
        *,
        sample_rate: int = 16000,
        channels: int = 1,
        channel_index: int = 0,
    ) -> list[float] | None:
        """PCM16 バイト列の指定チャンネルから正規化済み話者埋め込みを抽出する。"""
        ...


def resolve_speaker_model_path(raw_path: str | None = None) -> Path:
    """設定されたモデルパスを絶対パスへ解決する（相対パスは backend/ 基準）。"""
    configured = (raw_path or settings.speaker_model_path).strip()
    candidate = Path(configured)
    if candidate.is_absolute():
        return candidate
    backend_dir = Path(__file__).resolve().parents[2]
    return (backend_dir / candidate).resolve()


class SherpaSpeakerEmbeddingClient:
    """sherpa-onnx (CPU 実行) による話者埋め込み抽出アダプタ。"""

    def __init__(
        self,
        *,
        model_path: Path | None = None,
        model_id: str | None = None,
        num_threads: int | None = None,
    ) -> None:
        self._model_path = model_path or resolve_speaker_model_path()
        self._model_id = model_id or settings.speaker_model_id
        self._num_threads = max(
            1, num_threads if num_threads is not None else settings.speaker_num_threads
        )
        self._lock = threading.Lock()
        self._extractor: object | None = None
        self._embedding_dim = 192

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def embedding_dim(self) -> int:
        return self._embedding_dim

    def is_available(self) -> bool:
        """モデルファイルがローカルに存在するか確認する。"""
        return self._model_path.is_file()

    def _ensure_extractor(self) -> object:
        if self._extractor is not None:
            return self._extractor

        with self._lock:
            if self._extractor is not None:
                return self._extractor
            if not self._model_path.is_file():
                raise SpeakerEmbeddingClientError(
                    "話者認識モデルファイルが見つかりません。"
                    "PoC スクリプトまたはモデル配置を確認してください。",
                    code="SPEAKER_MODEL_NOT_FOUND",
                )
            try:
                import sherpa_onnx  # type: ignore[import-untyped]  # sherpa-onnx に型スタブが同梱されないため
            except ImportError as exc:
                raise SpeakerEmbeddingClientError(
                    "sherpa-onnx パッケージがインストールされていません。",
                    code="SPEAKER_RUNTIME_MISSING",
                ) from exc

            config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(self._model_path),
                num_threads=self._num_threads,
                debug=False,
                provider="cpu",
            )
            if not config.validate():
                raise SpeakerEmbeddingClientError(
                    "話者認識モデルの設定検証に失敗しました。",
                    code="SPEAKER_MODEL_INVALID",
                )
            extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
            self._embedding_dim = int(extractor.dim)
            self._extractor = extractor
            return extractor

    def extract_embedding_from_pcm16(
        self,
        pcm16_bytes: bytes,
        *,
        sample_rate: int = 16000,
        channels: int = 1,
        channel_index: int = 0,
    ) -> list[float] | None:
        if channels not in {1, 2} or sample_rate <= 0:
            raise SpeakerEmbeddingClientError(
                "未対応のチャンネル数またはサンプルレートです。",
                code="INVALID_AUDIO_FORMAT",
            )
        if channel_index not in {0, 1} or (channels == 1 and channel_index != 0):
            raise SpeakerEmbeddingClientError(
                "指定チャンネルが範囲外です。",
                code="INVALID_CHANNEL",
            )

        frame_bytes = 2 * channels
        usable_bytes = len(pcm16_bytes) - (len(pcm16_bytes) % frame_bytes)
        if usable_bytes <= 0:
            return None

        int16_arr = np.frombuffer(pcm16_bytes[:usable_bytes], dtype="<i2")
        mono_int16 = int16_arr[channel_index::2] if channels == 2 else int16_arr
        mono_float = (mono_int16.astype(np.float32) / 32768.0).tolist()

        extractor = self._ensure_extractor()
        # sherpa_onnx.SpeakerEmbeddingExtractor のメソッド型は動的解決となるため呼び出しを隔離する
        stream = extractor.create_stream()  # type: ignore[attr-defined]  # 外部C++バインディング型のため
        stream.accept_waveform(sample_rate=sample_rate, waveform=mono_float)
        stream.input_finished()
        if not extractor.is_ready(stream):  # type: ignore[attr-defined]  # 外部C++バインディング型のため
            return None
        raw_emb = extractor.compute(stream)  # type: ignore[attr-defined]  # 外部C++バインディング型のため
        vec = np.asarray(raw_emb, dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        if norm <= 1e-12 or not np.isfinite(norm):
            return None
        normalized = vec / norm
        if not np.all(np.isfinite(normalized)):
            return None
        return [float(val) for val in normalized.tolist()]


_client_lock = threading.Lock()
_cached_client_key: tuple[str, str, int] | None = None
_cached_client: SherpaSpeakerEmbeddingClient | None = None


def get_default_speaker_embedding_client(
    *,
    require_available: bool = False,
) -> SherpaSpeakerEmbeddingClient | None:
    """既定の CPU 話者埋め込みクライアントを返す（無効・モデル未配置時は None）。"""
    global _cached_client_key, _cached_client
    if not settings.speaker_recognition_enabled:
        return None

    model_path = resolve_speaker_model_path()
    key = (str(model_path), settings.speaker_model_id, settings.speaker_num_threads)
    with _client_lock:
        if _cached_client is None or _cached_client_key != key:
            _cached_client = SherpaSpeakerEmbeddingClient(
                model_path=model_path,
                model_id=settings.speaker_model_id,
                num_threads=settings.speaker_num_threads,
            )
            _cached_client_key = key
        client = _cached_client

    if not client.is_available():
        if require_available:
            raise SpeakerEmbeddingClientError(
                "話者認識モデルファイルが配置されていないため登録を実行できません。",
                code="SPEAKER_MODEL_NOT_FOUND",
            )
        return None
    return client
