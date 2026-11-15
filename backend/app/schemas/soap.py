from typing import Literal

from pydantic import BaseModel, Field

SpeakerRole = Literal["pharmacist", "patient"]
SoapSectionKey = Literal["S", "O", "A", "P"]
SoapItemOrigin = Literal["conversation", "plan_inference"]
SoapVerificationStatus = Literal["reported", "confirmed", "draft_inference"]
TranscriptStatus = Literal["interim", "final", "refined"]
SoapLifecycleStatus = Literal["idle", "pending", "updating", "ready", "error", "disabled"]


class TranscriptSegmentModel(BaseModel):
    """Backend で正規化された発話セグメント。"""

    stream_id: str
    segment_id: str
    segment_revision: int = Field(ge=1)
    transcript_revision: int = Field(ge=1)
    channel_index: Literal[0, 1]
    speaker_role: SpeakerRole
    speaker_label: str
    text: str
    status: TranscriptStatus
    start_sec: float = Field(ge=0.0)
    end_sec: float = Field(ge=0.0)
    confidence: float = Field(ge=0.0, le=1.0)
    speech_final: bool = False


class SoapEvidenceModel(BaseModel):
    """SOAP 要素の根拠となる発話参照と抜粋。"""

    stream_id: str
    segment_id: str
    segment_revision: int = Field(ge=1)
    quote: str = Field(min_length=1)
    speaker_role: SpeakerRole


class PlanItemRefModel(BaseModel):
    """P から推測した A 要素が参照する計画要素の版情報。"""

    item_id: str
    item_revision: int = Field(ge=1)


class SoapItemModel(BaseModel):
    """SOAP の各欄に配置する安定した単一要素。"""

    item_id: str
    item_revision: int = Field(ge=1)
    text: str = Field(min_length=1)
    evidence: list[SoapEvidenceModel] = Field(min_length=1)
    origin: SoapItemOrigin
    derived_from_plan_items: list[PlanItemRefModel] = Field(default_factory=list)
    stale_after_plan_update: bool = False
    verification_status: SoapVerificationStatus = "reported"


class SoapSectionModel(BaseModel):
    """S・O・P 各欄の状態。"""

    revision: int = Field(default=0, ge=0)
    items: list[SoapItemModel] = Field(default_factory=list)


class SoapAssessmentSectionModel(SoapSectionModel):
    """A 欄の状態（P 由来の最終推測が参照した P 版を含む）。"""

    derived_from_plan_revision: int | None = None


class SoapSectionsModel(BaseModel):
    """1会話に固定で1組だけ持つ S・O・A・P の4欄。"""

    S: SoapSectionModel = Field(default_factory=SoapSectionModel)
    O: SoapSectionModel = Field(default_factory=SoapSectionModel)  # noqa: E741  # SOAP形式のO(客観的情報)欄名
    A: SoapAssessmentSectionModel = Field(default_factory=SoapAssessmentSectionModel)
    P: SoapSectionModel = Field(default_factory=SoapSectionModel)


class SoapNoteModel(BaseModel):
    """1会話につき1件だけ保持する SOAP ノート全体。"""

    soap_id: str
    conversation_id: str
    revision: int = Field(default=0, ge=0)
    processed_transcript_revision: int = Field(default=0, ge=0)
    sections: SoapSectionsModel = Field(default_factory=SoapSectionsModel)


class LlmEvidenceRef(BaseModel):
    """LLM が構造化出力で返す発話根拠参照。"""

    stream_id: str
    segment_id: str
    segment_revision: int = Field(ge=1)
    quote: str = Field(min_length=1)


class LlmPlanRef(BaseModel):
    """LLM が A 最終更新時に返す参照元 P 要素。"""

    item_id: str
    item_revision: int = Field(ge=1)


class LlmSoapOperation(BaseModel):
    """会話中の extract_spoa タスクが返す構造化操作候補。"""

    action: Literal["add", "update", "retract"]
    section: SoapSectionKey
    item_id: str | None = None
    target_section: SoapSectionKey | None = None
    text: str | None = None
    evidence_refs: list[LlmEvidenceRef] = Field(default_factory=list)
    retraction_reason: str | None = None
    verification_status: Literal["reported", "confirmed"] = "reported"


class LlmExtractSpoaResult(BaseModel):
    """会話中タスク extract_spoa の構造化出力契約。"""

    operations: list[LlmSoapOperation] = Field(default_factory=list)


class LlmFinalizeAOperation(BaseModel):
    """停止時タスク finalize_a_from_p が返す A 推測操作候補。"""

    action: Literal["add", "update", "retract"]
    item_id: str | None = None
    text: str | None = None
    derived_from_plan_items: list[LlmPlanRef] = Field(default_factory=list)
    evidence_refs: list[LlmEvidenceRef] = Field(default_factory=list)
    retraction_reason: str | None = None


class LlmFinalizeAResult(BaseModel):
    """停止時タスク finalize_a_from_p の構造化出力契約。"""

    operations: list[LlmFinalizeAOperation] = Field(default_factory=list)


class BaseConversationEvent(BaseModel):
    """WebSocket 会話イベントの共通ヘッダ。"""

    protocol_version: int = 1
    conversation_id: str
    event_id: str
    sequence: int = Field(ge=1)


class TranscriptUpdatedEvent(BaseConversationEvent):
    """正規化済み発話の作成・更新通知。"""

    type: Literal["TranscriptUpdated"] = "TranscriptUpdated"
    segment: TranscriptSegmentModel
    removed: bool = False


class SoapStatusEvent(BaseConversationEvent):
    """SOAP 生成状態と未反映状態の通知。"""

    type: Literal["SoapStatus"] = "SoapStatus"
    status: SoapLifecycleStatus
    has_unapplied_transcript: bool = False
    pending_from_transcript_revision: int | None = None
    message: str | None = None


class SoapUpdatedEvent(BaseConversationEvent):
    """検証・適用済みの SOAP 全体スナップショット。"""

    type: Literal["SoapUpdated"] = "SoapUpdated"
    soap: SoapNoteModel
    changed_item_ids: list[str] = Field(default_factory=list)
    retracted_item_ids: list[str] = Field(default_factory=list)


class ConversationSnapshotEvent(BaseConversationEvent):
    """発話一覧と SOAP を整合した状態で渡す初期/再同期スナップショット。"""

    type: Literal["ConversationSnapshot"] = "ConversationSnapshot"
    segments: list[TranscriptSegmentModel] = Field(default_factory=list)
    soap: SoapNoteModel
    soap_status: SoapLifecycleStatus = "idle"
    has_unapplied_transcript: bool = False


class ConversationCompletedEvent(BaseConversationEvent):
    """停止・上限終了時に最終発話と可能な範囲の最終 SOAP 完了を知らせる通知。"""

    type: Literal["ConversationCompleted"] = "ConversationCompleted"
    reason: Literal["stopped", "session_limit", "auth_expired", "upstream_closed"]
    final_transcript_revision: int = Field(ge=0)
    soap_revision: int = Field(ge=0)
    has_unapplied_transcript: bool = False
    message: str | None = None
