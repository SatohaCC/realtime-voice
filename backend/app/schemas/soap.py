from typing import Literal

from pydantic import BaseModel, Field

SpeakerRole = Literal["pharmacist", "patient", "unknown"]
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

    stream_id: str = Field(description="参照元発話の stream_id を入力JSONからそのままコピーする")
    segment_id: str = Field(description="参照元発話の segment_id を入力JSONからそのままコピーする")
    segment_revision: int = Field(
        ge=1,
        description="参照元発話の segment_revision を入力JSONからそのままコピーする",
    )
    quote: str = Field(
        min_length=1,
        description="参照元発話 text からの一字一句変えない連続部分文字列（要約・言い換え禁止）",
    )


class LlmPlanRef(BaseModel):
    """LLM が A 最終更新時に返す参照元 P 要素。"""

    item_id: str = Field(description="plan_items 内の既存 P 要素の item_id")
    item_revision: int = Field(ge=1, description="plan_items 内の既存 P 要素の item_revision")


class LlmSoapOperation(BaseModel):
    """会話中の extract_spoa タスクが返す構造化操作候補。"""

    action: Literal["add", "update", "retract"] = Field(
        description=(
            "add: 新規追加, update: 既存item_id更新または欄移動, retract: 訂正等による撤回"
        )
    )
    section: SoapSectionKey = Field(
        description=(
            "対象欄 (S:主観的情報, O:客観的情報, A:アセスメント[SOをもとにPを実施した理由], P:計画)"
        )
    )
    item_id: str | None = Field(
        default=None,
        description=(
            "update または retract のときのみ current_soap の既存 item_id を指定。add 時は null"
        ),
    )
    target_section: SoapSectionKey | None = Field(
        default=None,
        description="別欄へ移動する update のときのみ移動先の欄を指定。通常は null",
    )
    text: str | None = Field(
        default=None,
        description="add または update 後の簡潔な日本語要約テキスト。retract 時は null",
    )
    evidence_refs: list[LlmEvidenceRef] = Field(
        default_factory=list,
        description="操作の直接根拠となる発話参照の配列（必須・最低1件）",
    )
    retraction_reason: str | None = Field(
        default=None,
        description="action=retract のときのみ撤回理由を記述。それ以外は null",
    )
    verification_status: Literal["reported", "confirmed"] = Field(
        default="reported",
        description="O欄で薬剤師が測定・確認した事実なら confirmed、患者申告や一般項目は reported",
    )


class LlmExtractSpoaResult(BaseModel):
    """会話中タスク extract_spoa の構造化出力契約。"""

    operations: list[LlmSoapOperation] = Field(
        default_factory=list,
        description=(
            "適用すべき SOAP 差分操作のリスト。該当なし（挨拶・質問のみ等）の場合は空配列 []"
        ),
    )


class LlmFinalizeAOperation(BaseModel):
    """停止時タスク finalize_a_from_p が返す A 推測操作候補。"""

    action: Literal["add", "update", "retract"] = Field(
        description=(
            "add: アセスメント案の新規追加, update: 既存 plan_inference 項目の更新, retract: 撤回"
        )
    )
    item_id: str | None = Field(
        default=None,
        description=(
            "existing_a_items 内の origin='plan_inference' を更新/撤回時のみ指定。add 時は null"
        ),
    )
    text: str | None = Field(
        default=None,
        description=(
            "S・O の情報から判断して P を実施した理由をまとめた要確認のアセスメント案テキスト。"
            "retract 時は null"
        ),
    )
    derived_from_plan_items: list[LlmPlanRef] = Field(
        default_factory=list,
        description="根拠とした plan_items の item_id と item_revision の配列",
    )
    evidence_refs: list[LlmEvidenceRef] = Field(
        default_factory=list,
        description="P 要素が持つ根拠発話参照。省略時は空配列 []（Pの根拠を自動継承）",
    )
    retraction_reason: str | None = Field(
        default=None,
        description="action=retract のときのみ撤回理由を記述。それ以外は null",
    )


class LlmFinalizeAResult(BaseModel):
    """停止時タスク finalize_a_from_p の構造化出力契約。"""

    operations: list[LlmFinalizeAOperation] = Field(
        default_factory=list,
        description="plan_inference に対する操作のリスト。操作不要なら空配列 []",
    )


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
