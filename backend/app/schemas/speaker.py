from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.soap import SoapNoteModel, SpeakerRole, TranscriptSegmentModel


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


class SetSegmentEnabledFrame(BaseModel):
    """原文を保持したまま、確定発話の根拠としての有効性を変更する。"""

    type: Literal["SetSegmentEnabled"]
    stream_id: str = Field(min_length=1, max_length=128)
    segment_id: str = Field(min_length=1, max_length=128)
    enabled: bool


class SetConversationSegmentEnabledResponse(BaseModel):
    """REST 経由での発話有効性変更と SOAP 再生成結果。"""

    conversation_id: str
    segment: TranscriptSegmentModel
    soap: SoapNoteModel
    changed_item_ids: list[str] = Field(default_factory=list)
    retracted_item_ids: list[str] = Field(default_factory=list)
    soap_status: str = "ready"
    has_unapplied_transcript: bool = False
