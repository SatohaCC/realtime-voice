from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class UploadRequest(BaseModel):
    """分割アップロード開始リクエスト。"""

    model_config = ConfigDict(extra="forbid", strict=True)

    filename: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(ge=1)
    source_sha256: str = Field(min_length=64, max_length=64)


class UploadResponse(BaseModel):
    """分割アップロード開始レスポンス。"""

    upload_id: str
    chunk_bytes: int
    expires_in_seconds: int = 3600


class ImportedProductResponse(BaseModel):
    """取り込まれた製品情報。"""

    yj_code: str | None = None
    brand_name: str | None = None


class ImportedRevisionResponse(BaseModel):
    """取り込まれた改訂履歴情報。"""

    source_label: str | None = None
    year_month: str | None = None
    version: str | None = None


class ImportWarningResponse(BaseModel):
    """XML 取り込み時の警告情報。"""

    code: str
    reference: str


class CleanupPendingItemResponse(BaseModel):
    """削除保留中バージョンの情報。"""

    version_id: str
    reason: str


class PackageInsertImportResponse(BaseModel):
    """添付文書 XML 取り込み結果レスポンス。"""

    document_id: str
    source_sha256: str
    status: Literal["active", "superseded"]
    reused: bool
    validation_status: str
    section_count: int
    search_unit_count: int
    products: list[ImportedProductResponse]
    revisions: list[ImportedRevisionResponse]
    warnings: list[ImportWarningResponse] = Field(default_factory=list)
    transformer_version: str = "1.0"
    search_index_updated: bool
    generation_id: str | None = None
    registration_sequence: int
    active_yj_codes: list[str] = Field(default_factory=list)
    replaced_yj_codes: list[str] = Field(default_factory=list)
    deleted_version_ids: list[str] = Field(default_factory=list)
    cleanup_pending: list[CleanupPendingItemResponse] = Field(default_factory=list)
    artifacts_deleted: bool = False


class ImportSummaryResponse(BaseModel):
    """取り込み履歴一覧の各項目。"""

    document_id: str
    source_sha256: str
    filename: str | None = None
    registration_sequence: int
    revised_at: str
    products: list[ImportedProductResponse] = Field(default_factory=list)
    active_yj_codes: list[str] = Field(default_factory=list)
    artifacts_deleted: bool = False


class ImportListResponse(BaseModel):
    """取り込み履歴一覧レスポンス。"""

    items: list[ImportSummaryResponse] = Field(default_factory=list)
    total_count: int = 0
    limit: int
    offset: int


class MedicineMatchResponse(BaseModel):
    """検索フィルタ用の登録済み医薬品候補。"""

    generic_name: str
    brand_names: list[str] = Field(default_factory=list)
    yj_codes: list[str] = Field(default_factory=list)
    document_ids: list[str] = Field(default_factory=list)


class MedicineListResponse(BaseModel):
    """登録済み医薬品一覧レスポンス。"""

    items: list[MedicineMatchResponse] = Field(default_factory=list)
    generation_id: str


class EvidenceSourceResponse(BaseModel):
    """検索でヒットした添付文書の根拠単位。"""

    unit_id: str
    document_id: str
    product_name: str
    generic_name: str
    product_yj_codes: list[str] = Field(default_factory=list)
    document_revision: dict[str, Any] = Field(default_factory=dict)
    section: dict[str, str] = Field(default_factory=dict)
    kind: str
    excerpt: str
    columns: dict[str, str] | None = None
    references: list[dict[str, Any]] = Field(default_factory=list)
    url: str
    retrieved_by: list[str] = Field(default_factory=list)


class KeywordSearchResponse(BaseModel):
    """添付文書キーワード検索レスポンス。"""

    query: str
    items: list[EvidenceSourceResponse] = Field(default_factory=list)
    total_count: int = 0
    expanded_keywords: list[str] = Field(default_factory=list)
