from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.soap import SpeakerRole


class SpeakerEnrollmentResponse(BaseModel):
    """事前登録音声から抽出した話者ベクトルと品質情報（端末ローカル保存用）。"""

    model_id: str = Field(min_length=1)
    embedding_dim: int = Field(ge=1)
    embedding: list[float] = Field(min_length=16, max_length=2048)
    duration_sec: float = Field(ge=0.0)
    voiced_sec: float = Field(ge=0.0)
    rms_level: float = Field(ge=0.0)
    peak_level: float = Field(ge=0.0)
    quality_warnings: list[str] = Field(default_factory=list)


class SpeakerProfileFrame(BaseModel):
    """WebSocket 接続確立後にブラウザの端末ローカル保存から送信する薬剤師声紋。"""

    type: Literal["SpeakerProfile"]
    model_id: str = Field(min_length=1, max_length=128)
    embedding: list[float] = Field(min_length=16, max_length=2048)


class SpeakerProfileAckEvent(BaseModel):
    """薬剤師声紋プロファイルのセッションメモリ反映結果通知。"""

    type: Literal["SpeakerProfileAck"] = "SpeakerProfileAck"
    accepted: bool
    model_id: str
    reason: str | None = None


class SegmentSpeakerOverrideFrame(BaseModel):
    """画面からの手動操作で確定済み発話の話者ロールを訂正する制御フレーム。"""

    type: Literal["UpdateSegmentSpeaker"]
    stream_id: str = Field(min_length=1, max_length=128)
    segment_id: str = Field(min_length=1, max_length=128)
    speaker_role: SpeakerRole
