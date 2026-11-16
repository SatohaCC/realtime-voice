from __future__ import annotations

import hashlib
import json
import threading
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    Table,
    Text,
    create_engine,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import StaticPool

from app.schemas.package_insert import (
    CleanupPendingItemResponse,
    ImportedProductResponse,
    ImportedRevisionResponse,
    ImportListResponse,
    ImportSummaryResponse,
    ImportWarningResponse,
    MedicineListResponse,
    MedicineMatchResponse,
    PackageInsertImportResponse,
)


class PackageInsertStoreError(Exception):
    """添付文書ストアの検証・永続化・競合エラー。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        phase: str = "publication",
        conflicts: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.phase = phase
        self.conflicts = conflicts or []


@dataclass(frozen=True)
class StoredSearchUnit:
    """検索用に保存された添付文書セクション単位。"""

    unit_id: str
    document_id: str
    position: int
    section_code: str
    section_title: str
    kind: str
    product_name: str
    generic_name: str
    product_yj_codes: tuple[str, ...]
    document_revision: dict[str, Any]
    text: str
    query_text: str
    columns: dict[str, str] | None
    references: tuple[dict[str, Any], ...]
    url: str


@dataclass(frozen=True)
class StoredDocumentInput:
    """ストアへ登録するパース済み添付文書入力。"""

    document_id: str
    source_sha256: str
    filename: str
    revised_at: str
    generic_name: str
    pmda_url: str
    section_count: int
    products: tuple[ImportedProductResponse, ...]
    revisions: tuple[ImportedRevisionResponse, ...]
    warnings: tuple[ImportWarningResponse, ...]
    yj_codes: tuple[str, ...]
    search_units: tuple[StoredSearchUnit, ...]
    validation_status: str = "valid"
    source_bytes: bytes = b""
    transformer_version: str = "1.0"
    cleanup_pending: tuple[CleanupPendingItemResponse, ...] = field(default_factory=tuple)


class PackageInsertStoreProtocol(Protocol):
    """添付文書の登録・履歴・検索単位を永続化する契約。"""

    def create_upload(self, filename: str, byte_size: int, source_sha256: str) -> str: ...

    def put_upload_part(self, upload_id: str, part_index: int, content: bytes) -> None: ...

    def assemble_upload(self, upload_id: str) -> tuple[str, str, bytes]: ...

    def save_document(self, doc: StoredDocumentInput) -> PackageInsertImportResponse: ...

    def get_import_result(
        self, document_id: str, source_sha256: str
    ) -> PackageInsertImportResponse: ...

    def list_imports(self, *, limit: int, offset: int) -> ImportListResponse: ...

    def list_active_medicines(self) -> MedicineListResponse: ...

    def get_active_search_units(
        self, yj_codes: Sequence[str] | None = None
    ) -> list[StoredSearchUnit]: ...


def _normalize_database_url(database_url: str) -> str:
    cleaned = database_url.strip()
    if cleaned.startswith("postgres://"):
        return "postgresql+psycopg://" + cleaned.removeprefix("postgres://")
    if cleaned.startswith("postgresql://"):
        return "postgresql+psycopg://" + cleaned.removeprefix("postgresql://")
    return cleaned


_metadata = MetaData()

_uploads = Table(
    "package_insert_uploads",
    _metadata,
    Column("upload_id", Text, primary_key=True),
    Column("filename", Text, nullable=False),
    Column("byte_size", Integer, nullable=False),
    Column("source_sha256", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("completed", Boolean, nullable=False, default=False),
)

_upload_parts = Table(
    "package_insert_upload_parts",
    _metadata,
    Column(
        "upload_id",
        Text,
        ForeignKey("package_insert_uploads.upload_id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("part_index", Integer, primary_key=True),
    Column("content", LargeBinary, nullable=False),
)

_state = Table(
    "package_insert_state",
    _metadata,
    Column("id", Integer, primary_key=True),
    Column("sequence", Integer, nullable=False),
    Column("generation_id", Text, nullable=False),
)

_receipts = Table(
    "package_insert_receipts",
    _metadata,
    Column("version_id", Text, primary_key=True),
    Column("document_id", Text, nullable=False),
    Column("source_sha256", Text, nullable=False),
    Column("filename", Text, nullable=False),
    Column("sequence", Integer, unique=True, nullable=False),
    Column("revised_at", Text, nullable=False),
    Column("generic_name", Text, nullable=False),
    Column("pmda_url", Text, nullable=False),
    Column("validation_status", Text, nullable=False),
    Column("transformer_version", Text, nullable=False),
    Column("section_count", Integer, nullable=False),
    Column("search_unit_count", Integer, nullable=False),
    Column("products_json", Text, nullable=False),
    Column("revisions_json", Text, nullable=False),
    Column("warnings_json", Text, nullable=False),
    Column("yj_codes_json", Text, nullable=False),
    Column("artifacts_deleted", Boolean, nullable=False, default=False),
)

_search_units = Table(
    "package_insert_search_units",
    _metadata,
    Column(
        "version_id",
        Text,
        ForeignKey("package_insert_receipts.version_id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("unit_id", Text, primary_key=True),
    Column("position", Integer, nullable=False),
    Column("document_id", Text, nullable=False),
    Column("section_code", Text, nullable=False),
    Column("section_title", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("product_name", Text, nullable=False),
    Column("generic_name", Text, nullable=False),
    Column("yj_codes_json", Text, nullable=False),
    Column("revision_json", Text, nullable=False),
    Column("text", Text, nullable=False),
    Column("query_text", Text, nullable=False),
    Column("columns_json", Text, nullable=True),
    Column("references_json", Text, nullable=False),
    Column("url", Text, nullable=False),
)
Index("idx_pi_units_version_pos", _search_units.c.version_id, _search_units.c.position)

_active_yj = Table(
    "package_insert_active_yj",
    _metadata,
    Column("yj_code", Text, primary_key=True),
    Column(
        "version_id",
        Text,
        ForeignKey("package_insert_receipts.version_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("revised_at", Text, nullable=False),
)


class SqlAlchemyPackageInsertStore:
    """SQLAlchemy（PostgreSQL / SQLite）ベースの添付文書ストア。"""

    def __init__(self, database_url: str) -> None:
        normalized = _normalize_database_url(database_url)
        self._is_sqlite = normalized.startswith("sqlite")
        if normalized in {"sqlite://", "sqlite:///:memory:"}:
            self._engine: Engine = create_engine(
                normalized,
                connect_args={"check_same_thread": False},
                poolclass=StaticPool,
                future=True,
            )
        elif self._is_sqlite:
            self._engine = create_engine(
                normalized,
                connect_args={"check_same_thread": False},
                future=True,
            )
        else:
            self._engine = create_engine(normalized, pool_pre_ping=True, future=True)
        self._lock = threading.RLock()
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self._lock:
            _metadata.create_all(self._engine, checkfirst=True)
            with self._engine.begin() as conn:
                existing = conn.execute(select(_state.c.id).where(_state.c.id == 1)).first()
                if existing is None:
                    conn.execute(
                        insert(_state),
                        {
                            "id": 1,
                            "sequence": 0,
                            "generation_id": uuid.uuid4().hex,
                        },
                    )

    @staticmethod
    def _ensure_state_row(conn: Connection) -> dict[str, Any]:
        row = conn.execute(select(_state).where(_state.c.id == 1)).mappings().first()
        if row is None:
            gen_id = uuid.uuid4().hex
            conn.execute(insert(_state), {"id": 1, "sequence": 0, "generation_id": gen_id})
            return {"id": 1, "sequence": 0, "generation_id": gen_id}
        return dict(row)

    @staticmethod
    def _build_import_response(
        receipt: dict[str, Any],
        *,
        active_yj_codes: list[str],
        generation_id: str | None,
        reused: bool,
        search_index_updated: bool,
        replaced_yj_codes: list[str] | None = None,
        deleted_version_ids: list[str] | None = None,
    ) -> PackageInsertImportResponse:
        products = [
            ImportedProductResponse(**item) for item in json.loads(receipt["products_json"])
        ]
        revisions = [
            ImportedRevisionResponse(**item) for item in json.loads(receipt["revisions_json"])
        ]
        warnings = [ImportWarningResponse(**item) for item in json.loads(receipt["warnings_json"])]
        status: Any = "active" if active_yj_codes else "superseded"
        return PackageInsertImportResponse(
            document_id=receipt["document_id"],
            source_sha256=receipt["source_sha256"],
            status=status,
            reused=reused,
            validation_status=receipt["validation_status"],
            section_count=receipt["section_count"],
            search_unit_count=receipt["search_unit_count"],
            products=products,
            revisions=revisions,
            warnings=warnings,
            transformer_version=receipt["transformer_version"],
            search_index_updated=search_index_updated,
            generation_id=generation_id,
            registration_sequence=receipt["sequence"],
            active_yj_codes=sorted(active_yj_codes),
            replaced_yj_codes=sorted(replaced_yj_codes or []),
            deleted_version_ids=sorted(deleted_version_ids or []),
            cleanup_pending=[],
            artifacts_deleted=bool(receipt["artifacts_deleted"]),
        )

    def create_upload(self, filename: str, byte_size: int, source_sha256: str) -> str:
        upload_id = uuid.uuid4().hex
        expires_at = datetime.now(UTC) + timedelta(hours=1)
        try:
            with self._lock, self._engine.begin() as conn:
                conn.execute(
                    insert(_uploads),
                    {
                        "upload_id": upload_id,
                        "filename": filename,
                        "byte_size": byte_size,
                        "source_sha256": source_sha256.lower(),
                        "expires_at": expires_at,
                        "completed": False,
                    },
                )
            return upload_id
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "upload_storage_error",
                "アップロードセッションを作成できませんでした。",
                status_code=500,
                phase="upload",
            ) from exc

    def put_upload_part(self, upload_id: str, part_index: int, content: bytes) -> None:
        if part_index < 0 or not content:
            raise PackageInsertStoreError(
                "invalid_upload_part",
                "分割パートが不正です。",
                status_code=422,
                phase="upload",
            )
        try:
            with self._lock, self._engine.begin() as conn:
                session = (
                    conn.execute(select(_uploads).where(_uploads.c.upload_id == upload_id))
                    .mappings()
                    .first()
                )
                if session is None:
                    raise PackageInsertStoreError(
                        "upload_not_found",
                        "アップロードセッションが見つかりません。",
                        status_code=404,
                        phase="upload",
                    )
                if session["completed"]:
                    raise PackageInsertStoreError(
                        "upload_already_completed",
                        "このアップロードは既に完了しています。",
                        status_code=409,
                        phase="upload",
                    )
                expires_at = session["expires_at"]
                if isinstance(expires_at, datetime):
                    exp_utc = (
                        expires_at.replace(tzinfo=UTC)
                        if expires_at.tzinfo is None
                        else expires_at.astimezone(UTC)
                    )
                    if exp_utc < datetime.now(UTC):
                        raise PackageInsertStoreError(
                            "upload_expired",
                            "アップロードセッションの有効期限が切れました。",
                            status_code=410,
                            phase="upload",
                        )
                existing_part = conn.execute(
                    select(_upload_parts.c.part_index).where(
                        (_upload_parts.c.upload_id == upload_id)
                        & (_upload_parts.c.part_index == part_index)
                    )
                ).first()
                if existing_part is not None:
                    conn.execute(
                        update(_upload_parts)
                        .where(
                            (_upload_parts.c.upload_id == upload_id)
                            & (_upload_parts.c.part_index == part_index)
                        )
                        .values(content=content)
                    )
                else:
                    conn.execute(
                        insert(_upload_parts),
                        {
                            "upload_id": upload_id,
                            "part_index": part_index,
                            "content": content,
                        },
                    )
        except PackageInsertStoreError:
            raise
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "upload_storage_error",
                "分割パートの保存に失敗しました。",
                status_code=500,
                phase="upload",
            ) from exc

    def assemble_upload(self, upload_id: str) -> tuple[str, str, bytes]:
        try:
            with self._lock, self._engine.begin() as conn:
                session = (
                    conn.execute(select(_uploads).where(_uploads.c.upload_id == upload_id))
                    .mappings()
                    .first()
                )
                if session is None:
                    raise PackageInsertStoreError(
                        "upload_not_found",
                        "アップロードセッションが見つかりません。",
                        status_code=404,
                        phase="upload",
                    )
                if session["completed"]:
                    raise PackageInsertStoreError(
                        "upload_already_completed",
                        "このアップロードは既に完了しています。",
                        status_code=409,
                        phase="upload",
                    )
                parts = (
                    conn.execute(
                        select(_upload_parts)
                        .where(_upload_parts.c.upload_id == upload_id)
                        .order_by(_upload_parts.c.part_index.asc())
                    )
                    .mappings()
                    .all()
                )
                if not parts:
                    raise PackageInsertStoreError(
                        "upload_incomplete",
                        "アップロードパートが見つかりません。",
                        status_code=422,
                        phase="upload",
                    )
                expected_indices = list(range(len(parts)))
                actual_indices = [int(p["part_index"]) for p in parts]
                if actual_indices != expected_indices:
                    raise PackageInsertStoreError(
                        "upload_incomplete",
                        "アップロードパートに欠番があります。",
                        status_code=422,
                        phase="upload",
                    )
                assembled = b"".join(bytes(p["content"]) for p in parts)
                if len(assembled) != int(session["byte_size"]):
                    raise PackageInsertStoreError(
                        "upload_size_mismatch",
                        "結合後のファイルサイズが宣言値と一致しません。",
                        status_code=422,
                        phase="upload",
                    )
                actual_sha256 = hashlib.sha256(assembled).hexdigest().lower()
                if actual_sha256 != str(session["source_sha256"]).lower():
                    raise PackageInsertStoreError(
                        "upload_hash_mismatch",
                        "結合後のファイルハッシュ値が一致しません。",
                        status_code=422,
                        phase="upload",
                    )
                conn.execute(
                    update(_uploads).where(_uploads.c.upload_id == upload_id).values(completed=True)
                )
                conn.execute(delete(_upload_parts).where(_upload_parts.c.upload_id == upload_id))
                return str(session["filename"]), actual_sha256, assembled
        except PackageInsertStoreError:
            raise
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "upload_storage_error",
                "アップロードファイルの結合に失敗しました。",
                status_code=500,
                phase="upload",
            ) from exc

    def save_document(self, doc: StoredDocumentInput) -> PackageInsertImportResponse:
        version_id = f"{doc.document_id}:{doc.source_sha256}"
        try:
            with self._lock, self._engine.begin() as conn:
                state_row = self._ensure_state_row(conn)
                existing_receipt = (
                    conn.execute(select(_receipts).where(_receipts.c.version_id == version_id))
                    .mappings()
                    .first()
                )
                if existing_receipt is not None:
                    active_codes = list(
                        conn.execute(
                            select(_active_yj.c.yj_code).where(
                                _active_yj.c.version_id == version_id
                            )
                        ).scalars()
                    )
                    return self._build_import_response(
                        dict(existing_receipt),
                        active_yj_codes=active_codes,
                        generation_id=str(state_row["generation_id"]),
                        reused=True,
                        search_index_updated=False,
                    )

                active_rows = (
                    conn.execute(select(_active_yj).where(_active_yj.c.yj_code.in_(doc.yj_codes)))
                    .mappings()
                    .all()
                )
                active_by_yj = {str(r["yj_code"]): dict(r) for r in active_rows}

                # 同一改訂年月・別原本の競合を検査する
                conflicts: list[dict[str, Any]] = []
                adopted_yj: list[str] = []
                replaced_yj: list[str] = []
                potentially_replaced_versions: set[str] = set()

                for code in doc.yj_codes:
                    current = active_by_yj.get(code)
                    if current is None:
                        adopted_yj.append(code)
                    elif str(current["revised_at"]) == doc.revised_at:
                        conflicts.append(
                            {
                                "yj_code": code,
                                "version_ids": [str(current["version_id"])],
                            }
                        )
                    elif doc.revised_at > str(current["revised_at"]):
                        adopted_yj.append(code)
                        replaced_yj.append(code)
                        potentially_replaced_versions.add(str(current["version_id"]))

                if conflicts:
                    raise PackageInsertStoreError(
                        "same_revision_conflict",
                        "同じ改訂年月の別原本が既に登録されているため、競合を解決できません。",
                        status_code=409,
                        phase="publication",
                        conflicts=conflicts,
                    )

                next_sequence = int(state_row["sequence"]) + 1
                is_active = len(adopted_yj) > 0
                generation_id = uuid.uuid4().hex if is_active else str(state_row["generation_id"])

                conn.execute(
                    insert(_receipts),
                    {
                        "version_id": version_id,
                        "document_id": doc.document_id,
                        "source_sha256": doc.source_sha256,
                        "filename": doc.filename,
                        "sequence": next_sequence,
                        "revised_at": doc.revised_at,
                        "generic_name": doc.generic_name,
                        "pmda_url": doc.pmda_url,
                        "validation_status": doc.validation_status,
                        "transformer_version": doc.transformer_version,
                        "section_count": doc.section_count,
                        "search_unit_count": len(doc.search_units),
                        "products_json": json.dumps(
                            [p.model_dump() for p in doc.products], ensure_ascii=False
                        ),
                        "revisions_json": json.dumps(
                            [r.model_dump() for r in doc.revisions], ensure_ascii=False
                        ),
                        "warnings_json": json.dumps(
                            [w.model_dump() for w in doc.warnings], ensure_ascii=False
                        ),
                        "yj_codes_json": json.dumps(list(doc.yj_codes), ensure_ascii=False),
                        "artifacts_deleted": not is_active,
                    },
                )

                if is_active:
                    if doc.search_units:
                        conn.execute(
                            insert(_search_units),
                            [
                                {
                                    "version_id": version_id,
                                    "unit_id": unit.unit_id,
                                    "position": unit.position,
                                    "document_id": unit.document_id,
                                    "section_code": unit.section_code,
                                    "section_title": unit.section_title,
                                    "kind": unit.kind,
                                    "product_name": unit.product_name,
                                    "generic_name": unit.generic_name,
                                    "yj_codes_json": json.dumps(
                                        list(unit.product_yj_codes), ensure_ascii=False
                                    ),
                                    "revision_json": json.dumps(
                                        unit.document_revision, ensure_ascii=False
                                    ),
                                    "text": unit.text,
                                    "query_text": unit.query_text,
                                    "columns_json": json.dumps(unit.columns, ensure_ascii=False)
                                    if unit.columns is not None
                                    else None,
                                    "references_json": json.dumps(
                                        list(unit.references), ensure_ascii=False
                                    ),
                                    "url": unit.url,
                                }
                                for unit in doc.search_units
                            ],
                        )

                    for code in adopted_yj:
                        if code in active_by_yj:
                            conn.execute(
                                update(_active_yj)
                                .where(_active_yj.c.yj_code == code)
                                .values(version_id=version_id, revised_at=doc.revised_at)
                            )
                        else:
                            conn.execute(
                                insert(_active_yj),
                                {
                                    "yj_code": code,
                                    "version_id": version_id,
                                    "revised_at": doc.revised_at,
                                },
                            )

                deleted_versions: list[str] = []
                for old_vid in sorted(potentially_replaced_versions):
                    remaining = conn.execute(
                        select(func.count())
                        .select_from(_active_yj)
                        .where(_active_yj.c.version_id == old_vid)
                    ).scalar_one()
                    if remaining == 0:
                        conn.execute(
                            delete(_search_units).where(_search_units.c.version_id == old_vid)
                        )
                        conn.execute(
                            update(_receipts)
                            .where(_receipts.c.version_id == old_vid)
                            .values(artifacts_deleted=True)
                        )
                        deleted_versions.append(old_vid)

                conn.execute(
                    update(_state)
                    .where(_state.c.id == 1)
                    .values(sequence=next_sequence, generation_id=generation_id)
                )

                saved = (
                    conn.execute(select(_receipts).where(_receipts.c.version_id == version_id))
                    .mappings()
                    .one()
                )
                return self._build_import_response(
                    dict(saved),
                    active_yj_codes=adopted_yj,
                    generation_id=generation_id,
                    reused=False,
                    search_index_updated=is_active,
                    replaced_yj_codes=replaced_yj,
                    deleted_version_ids=deleted_versions,
                )
        except PackageInsertStoreError:
            raise
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "import_storage_error",
                "添付文書のデータベース保存に失敗しました。",
                status_code=500,
                phase="publication",
            ) from exc

    def get_import_result(
        self, document_id: str, source_sha256: str
    ) -> PackageInsertImportResponse:
        version_id = f"{document_id}:{source_sha256}"
        try:
            with self._lock, self._engine.connect() as conn:
                receipt = (
                    conn.execute(select(_receipts).where(_receipts.c.version_id == version_id))
                    .mappings()
                    .first()
                )
                if receipt is None:
                    raise PackageInsertStoreError(
                        "import_not_found",
                        "指定された取り込み結果が見つかりません。",
                        status_code=404,
                    )
                if receipt["artifacts_deleted"]:
                    raise PackageInsertStoreError(
                        "version_deleted",
                        "この旧版の保存データは削除済みです。",
                        status_code=410,
                    )
                active_codes = list(
                    conn.execute(
                        select(_active_yj.c.yj_code).where(_active_yj.c.version_id == version_id)
                    ).scalars()
                )
                state_row = conn.execute(select(_state).where(_state.c.id == 1)).mappings().first()
                gen_id = str(state_row["generation_id"]) if state_row else None
                return self._build_import_response(
                    dict(receipt),
                    active_yj_codes=active_codes,
                    generation_id=gen_id,
                    reused=True,
                    search_index_updated=False,
                )
        except PackageInsertStoreError:
            raise
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "import_storage_error",
                "取り込み結果を取得できませんでした。",
                status_code=500,
            ) from exc

    def list_imports(self, *, limit: int, offset: int) -> ImportListResponse:
        try:
            with self._lock, self._engine.connect() as conn:
                total = int(
                    conn.execute(select(func.count()).select_from(_receipts)).scalar_one() or 0
                )
                rows = (
                    conn.execute(
                        select(_receipts)
                        .order_by(_receipts.c.sequence.desc())
                        .limit(limit)
                        .offset(offset)
                    )
                    .mappings()
                    .all()
                )
                version_ids = [str(r["version_id"]) for r in rows]
                active_map: dict[str, list[str]] = {}
                if version_ids:
                    for active_row in conn.execute(
                        select(_active_yj.c.version_id, _active_yj.c.yj_code).where(
                            _active_yj.c.version_id.in_(version_ids)
                        )
                    ):
                        active_map.setdefault(str(active_row.version_id), []).append(
                            str(active_row.yj_code)
                        )
                items = [
                    ImportSummaryResponse(
                        document_id=str(row["document_id"]),
                        source_sha256=str(row["source_sha256"]),
                        filename=str(row["filename"]) if row["filename"] else None,
                        registration_sequence=int(row["sequence"]),
                        revised_at=str(row["revised_at"]),
                        products=[
                            ImportedProductResponse(**p)
                            for p in json.loads(str(row["products_json"]))
                        ],
                        active_yj_codes=sorted(active_map.get(str(row["version_id"]), [])),
                        artifacts_deleted=bool(row["artifacts_deleted"]),
                    )
                    for row in rows
                ]
                return ImportListResponse(
                    items=items,
                    total_count=total,
                    limit=limit,
                    offset=offset,
                )
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "import_list_unavailable",
                "取り込み一覧を取得できません。",
                status_code=500,
            ) from exc

    def list_active_medicines(self) -> MedicineListResponse:
        try:
            with self._lock, self._engine.connect() as conn:
                state_row = conn.execute(select(_state).where(_state.c.id == 1)).mappings().first()
                gen_id = str(state_row["generation_id"]) if state_row else "empty"

                active_rows = conn.execute(
                    select(_active_yj.c.yj_code, _active_yj.c.version_id)
                ).all()
                if not active_rows:
                    return MedicineListResponse(items=[], generation_id=gen_id)

                active_by_version: dict[str, set[str]] = {}
                for row in active_rows:
                    active_by_version.setdefault(str(row.version_id), set()).add(str(row.yj_code))

                receipts = (
                    conn.execute(
                        select(_receipts)
                        .where(_receipts.c.version_id.in_(list(active_by_version)))
                        .order_by(_receipts.c.sequence.asc())
                    )
                    .mappings()
                    .all()
                )
                items: list[MedicineMatchResponse] = []
                for receipt in receipts:
                    vid = str(receipt["version_id"])
                    allowed_yj = active_by_version.get(vid, set())
                    products = [
                        ImportedProductResponse(**p)
                        for p in json.loads(str(receipt["products_json"]))
                    ]
                    generic_name = str(receipt["generic_name"] or "")
                    doc_id = str(receipt["document_id"])
                    yj_codes: list[str] = []
                    brand_names: list[str] = []
                    for product in products:
                        if product.yj_code and product.yj_code in allowed_yj:
                            yj_codes.append(product.yj_code)
                            brand_names.append(
                                product.brand_name or generic_name or product.yj_code
                            )
                    if yj_codes:
                        items.append(
                            MedicineMatchResponse(
                                generic_name=generic_name or brand_names[0],
                                brand_names=brand_names,
                                yj_codes=yj_codes,
                                document_ids=[doc_id],
                            )
                        )
                return MedicineListResponse(items=items, generation_id=gen_id)
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "medicine_list_unavailable",
                "登録済み医薬品一覧を取得できませんでした。",
                status_code=500,
            ) from exc

    def get_active_search_units(
        self, yj_codes: Sequence[str] | None = None
    ) -> list[StoredSearchUnit]:
        requested = {code.strip() for code in (yj_codes or ()) if code.strip()}
        try:
            with self._lock, self._engine.connect() as conn:
                if requested:
                    version_ids = list(
                        conn.execute(
                            select(_active_yj.c.version_id)
                            .where(_active_yj.c.yj_code.in_(requested))
                            .distinct()
                        ).scalars()
                    )
                else:
                    version_ids = list(
                        conn.execute(select(_active_yj.c.version_id).distinct()).scalars()
                    )
                if not version_ids:
                    return []

                rows = (
                    conn.execute(
                        select(_search_units)
                        .where(_search_units.c.version_id.in_(version_ids))
                        .order_by(_search_units.c.version_id.asc(), _search_units.c.position.asc())
                    )
                    .mappings()
                    .all()
                )
                units: list[StoredSearchUnit] = []
                for row in rows:
                    unit_yj_codes = tuple(json.loads(str(row["yj_codes_json"])))
                    if requested and not (set(unit_yj_codes) & requested):
                        continue
                    cols_raw = row["columns_json"]
                    units.append(
                        StoredSearchUnit(
                            unit_id=str(row["unit_id"]),
                            document_id=str(row["document_id"]),
                            position=int(row["position"]),
                            section_code=str(row["section_code"]),
                            section_title=str(row["section_title"]),
                            kind=str(row["kind"]),
                            product_name=str(row["product_name"]),
                            generic_name=str(row["generic_name"]),
                            product_yj_codes=unit_yj_codes,
                            document_revision=json.loads(str(row["revision_json"])),
                            text=str(row["text"]),
                            query_text=str(row["query_text"]),
                            columns=json.loads(str(cols_raw)) if cols_raw else None,
                            references=tuple(json.loads(str(row["references_json"]))),
                            url=str(row["url"]),
                        )
                    )
                return units
        except SQLAlchemyError as exc:
            raise PackageInsertStoreError(
                "search_unavailable",
                "添付文書の検索データ取得に失敗しました。",
                status_code=500,
            ) from exc


class InMemoryPackageInsertStore(SqlAlchemyPackageInsertStore):
    """DATABASE_URL 未設定時に利用するインメモリ SQLite ベースのストア。"""

    def __init__(self) -> None:
        super().__init__("sqlite:///:memory:")
