from __future__ import annotations

import asyncio
import hashlib
import math
import re
from collections.abc import Sequence
from functools import lru_cache

from app.clients.keyword_expander_client import (
    KeywordExpanderProtocol,
    LangChainKeywordExpanderClient,
)
from app.clients.package_insert_store_client import (
    InMemoryPackageInsertStore,
    PackageInsertStoreError,
    PackageInsertStoreProtocol,
    SqlAlchemyPackageInsertStore,
    StoredDocumentInput,
    StoredSearchUnit,
)
from app.core.config import settings
from app.schemas.package_insert import (
    EvidenceSourceResponse,
    ImportListResponse,
    KeywordSearchResponse,
    MedicineListResponse,
    PackageInsertImportResponse,
    UploadResponse,
)
from app.services.pmda_xml_service import (
    PmdaXmlError,
    normalize_search_text,
    parse_pmda_xml,
)

_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_YJ_CODE_RE = re.compile(r"^[0-9A-Za-z]{12}$")


class PackageInsertServiceError(Exception):
    """添付文書ユースケース層のエラー。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        phase: str = "validation",
        conflicts: list[dict[str, object]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.phase = phase
        self.conflicts = conflicts or []


@lru_cache(maxsize=4)
def _get_store_for_url(database_url: str) -> PackageInsertStoreProtocol:
    if database_url:
        return SqlAlchemyPackageInsertStore(database_url)
    return InMemoryPackageInsertStore()


def get_default_package_insert_store() -> PackageInsertStoreProtocol:
    """設定に応じた添付文書ストア（PostgreSQL またはインメモリ）を返す。"""
    return _get_store_for_url(settings.database_url)


@lru_cache(maxsize=1)
def get_default_keyword_expander() -> KeywordExpanderProtocol:
    """既定の LLM 類義語拡張クライアントを返す。"""
    return LangChainKeywordExpanderClient()


def _phrase_scores(texts: Sequence[str], phrase: str) -> dict[int, float]:
    """BM25 風フレーズスコアを計算する（小さい負値ほど高関連）。"""
    if len(phrase) < 3 or not texts:
        return {}
    lengths = [max(1, len(value) - 2) for value in texts]
    frequencies: list[int] = []
    for value in texts:
        count = 0
        start = 0
        while (start := value.find(phrase, start)) >= 0:
            count += 1
            start += 1
        frequencies.append(count)
    hit_count = sum(freq > 0 for freq in frequencies)
    if not hit_count:
        return {}
    inverse_frequency = math.log((len(texts) - hit_count + 0.5) / (hit_count + 0.5))
    if inverse_frequency <= 0:
        inverse_frequency = 1e-6
    average = sum(lengths) / len(texts)
    scores: dict[int, float] = {}
    for index, freq in enumerate(frequencies):
        if freq:
            scores[index] = -inverse_frequency * (
                (freq * 2.2) / (freq + 1.2 * (0.25 + 0.75 * lengths[index] / average))
            )
    return scores


def _sanitize_filename(filename: str) -> str:
    cleaned = filename.replace("\\", "/").split("/")[-1].strip()
    return cleaned[:255] or "source.xml"


def _store_document_from_xml(
    source: bytes, filename: str, store: PackageInsertStoreProtocol
) -> tuple[PackageInsertImportResponse, bool]:
    try:
        parsed = parse_pmda_xml(source, filename=_sanitize_filename(filename))
    except PmdaXmlError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc

    stored_input = StoredDocumentInput(
        document_id=parsed.document_id,
        source_sha256=parsed.source_sha256,
        filename=parsed.filename,
        revised_at=parsed.revised_at,
        generic_name=parsed.generic_name,
        pmda_url=parsed.pmda_url,
        section_count=parsed.section_count,
        products=parsed.products,
        revisions=parsed.revisions,
        warnings=parsed.warnings,
        yj_codes=parsed.yj_codes,
        search_units=tuple(
            StoredSearchUnit(
                unit_id=u.unit_id,
                document_id=parsed.document_id,
                position=u.position,
                section_code=u.section_code,
                section_title=u.section_title,
                kind=u.kind,
                product_name=u.product_name,
                generic_name=u.generic_name,
                product_yj_codes=u.product_yj_codes,
                document_revision=u.document_revision,
                text=u.text,
                query_text=u.query_text,
                columns=u.columns,
                references=u.references,
                url=u.url,
            )
            for u in parsed.search_units
        ),
        source_bytes=source,
    )
    try:
        result = store.save_document(stored_input)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code,
            exc.message,
            status_code=exc.status_code,
            phase=exc.phase,
            conflicts=exc.conflicts,
        ) from exc
    return result, not result.reused


def import_package_insert_xml(
    source: bytes,
    filename: str = "source.xml",
    *,
    store: PackageInsertStoreProtocol | None = None,
) -> tuple[PackageInsertImportResponse, bool]:
    """PMDA 電子添文 XML を解析してストアへ登録し、(結果, 新規登録か) を返す。"""
    resolved_store = store or get_default_package_insert_store()
    return _store_document_from_xml(source, filename, resolved_store)


def start_package_insert_upload(
    *,
    filename: str,
    byte_size: int,
    source_sha256: str,
    store: PackageInsertStoreProtocol | None = None,
) -> UploadResponse:
    """分割アップロードセッションを開始する。"""
    if byte_size < 1 or byte_size > settings.package_insert_max_bytes:
        raise PackageInsertServiceError(
            "source_size_limit",
            "XML ファイルサイズが上限（10MiB）を超えています。",
            status_code=413,
            phase="upload",
        )
    if not _SHA256_RE.match(source_sha256):
        raise PackageInsertServiceError(
            "invalid_upload",
            "SHA-256 ハッシュ形式が不正です。",
            status_code=422,
            phase="upload",
        )
    resolved_store = store or get_default_package_insert_store()
    try:
        upload_id = resolved_store.create_upload(
            _sanitize_filename(filename), byte_size, source_sha256.lower()
        )
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc
    return UploadResponse(
        upload_id=upload_id,
        chunk_bytes=settings.package_insert_chunk_bytes,
        expires_in_seconds=3600,
    )


def upload_package_insert_part(
    *,
    upload_id: str,
    part_index: int,
    content: bytes,
    store: PackageInsertStoreProtocol | None = None,
) -> None:
    """分割アップロードの 1 パートを保存する。"""
    if len(content) > settings.package_insert_chunk_bytes:
        raise PackageInsertServiceError(
            "upload_part_too_large",
            "分割パートのサイズが上限を超えています。",
            status_code=413,
            phase="upload",
        )
    resolved_store = store or get_default_package_insert_store()
    try:
        resolved_store.put_upload_part(upload_id, part_index, content)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc


def complete_package_insert_upload(
    *,
    upload_id: str,
    store: PackageInsertStoreProtocol | None = None,
) -> tuple[PackageInsertImportResponse, bool]:
    """分割アップロードを結合して添付文書を登録する。"""
    resolved_store = store or get_default_package_insert_store()
    try:
        filename, expected_sha, source = resolved_store.assemble_upload(upload_id)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc
    if hashlib.sha256(source).hexdigest().lower() != expected_sha:
        raise PackageInsertServiceError(
            "upload_hash_mismatch",
            "結合後のファイルハッシュ値が一致しません。",
            status_code=422,
            phase="upload",
        )
    return _store_document_from_xml(source, filename, resolved_store)


def list_package_insert_imports(
    *,
    limit: int = 20,
    offset: int = 0,
    store: PackageInsertStoreProtocol | None = None,
) -> ImportListResponse:
    """取り込み履歴一覧を取得する。"""
    resolved_store = store or get_default_package_insert_store()
    try:
        return resolved_store.list_imports(limit=limit, offset=offset)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc


def get_package_insert_import(
    *,
    document_id: str,
    source_sha256: str,
    store: PackageInsertStoreProtocol | None = None,
) -> PackageInsertImportResponse:
    """指定バージョンの取り込み結果を再取得する。"""
    resolved_store = store or get_default_package_insert_store()
    try:
        return resolved_store.get_import_result(document_id, source_sha256)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc


def list_registered_medicines(
    *,
    store: PackageInsertStoreProtocol | None = None,
) -> MedicineListResponse:
    """検索対象として有効な医薬品一覧を取得する。"""
    resolved_store = store or get_default_package_insert_store()
    try:
        return resolved_store.list_active_medicines()
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc


def validate_yj_codes(yj_codes: Sequence[str]) -> tuple[str, ...]:
    """クエリの YJ コード配列を正規化・検証する。"""
    normalized: list[str] = []
    for raw in yj_codes:
        code = raw.strip().upper()
        if not code:
            continue
        if not _YJ_CODE_RE.match(code):
            raise PackageInsertServiceError(
                "invalid_yj_code",
                f"YJ コード形式が不正です: {raw}",
                status_code=422,
            )
        normalized.append(code)
    return tuple(dict.fromkeys(normalized))


async def search_package_inserts(
    query: str,
    yj_codes: Sequence[str] = (),
    *,
    expand: bool = False,
    store: PackageInsertStoreProtocol | None = None,
    expander: KeywordExpanderProtocol | None = None,
) -> KeywordSearchResponse:
    """キーワードと対象 YJ コードに基づいて登録済み添付文書の根拠単位を検索する。"""
    trimmed_query = query.strip()
    if not trimmed_query:
        raise PackageInsertServiceError(
            "invalid_query",
            "検索キーワードを入力してください。",
            status_code=422,
        )
    valid_codes = validate_yj_codes(yj_codes)

    base_terms = tuple(
        dict.fromkeys(
            normalized
            for raw in re.split(r"[\s\u3000]+", trimmed_query)
            if (normalized := normalize_search_text(raw)) and len(normalized) >= 1
        )
    )

    expanded_terms: tuple[str, ...] = ()
    if expand:
        resolved_expander = expander or get_default_keyword_expander()
        try:
            raw_expanded = await resolved_expander.expand_keywords(trimmed_query)
            base_lower = {term.casefold() for term in base_terms}
            expanded_terms = tuple(
                dict.fromkeys(
                    cleaned
                    for raw in raw_expanded
                    if len(cleaned := raw.strip()) >= 2
                    and normalize_search_text(cleaned) not in base_lower
                )
            )
        except Exception:
            expanded_terms = ()

    resolved_store = store or get_default_package_insert_store()
    try:
        units = await asyncio.to_thread(resolved_store.get_active_search_units, valid_codes or None)
    except PackageInsertStoreError as exc:
        raise PackageInsertServiceError(
            exc.code, exc.message, status_code=exc.status_code, phase=exc.phase
        ) from exc

    if not units or (not base_terms and not expanded_terms):
        return KeywordSearchResponse(
            query=trimmed_query,
            items=[],
            total_count=0,
            expanded_keywords=list(expanded_terms),
        )

    texts = [unit.query_text for unit in units]
    combined_scores: dict[int, float] = {}

    def apply_term_scores(term: str, weight: float) -> None:
        normalized = normalize_search_text(term)
        if not normalized:
            return
        if len(normalized) >= 3:
            term_scores = _phrase_scores(texts, normalized)
            for idx, score in term_scores.items():
                combined_scores[idx] = combined_scores.get(idx, 0.0) + score * weight
        else:
            for idx, text in enumerate(texts):
                count = text.count(normalized)
                if count > 0:
                    combined_scores[idx] = combined_scores.get(idx, 0.0) - float(count) * weight

    for term in base_terms:
        apply_term_scores(term, 1.0)
    for term in expanded_terms:
        apply_term_scores(term, 0.6)

    ranked_indices = [
        idx
        for idx, _ in sorted(
            combined_scores.items(),
            key=lambda item: (item[1], units[item[0]].position, item[0]),
        )
    ]

    items = [
        EvidenceSourceResponse(
            unit_id=units[idx].unit_id,
            document_id=units[idx].document_id,
            product_name=units[idx].product_name,
            generic_name=units[idx].generic_name,
            product_yj_codes=list(units[idx].product_yj_codes),
            document_revision=units[idx].document_revision,
            section={
                "code": units[idx].section_code,
                "title": units[idx].section_title,
            },
            kind=units[idx].kind,
            excerpt=units[idx].text,
            columns=units[idx].columns,
            references=list(units[idx].references),
            url=units[idx].url,
            retrieved_by=["keyword"],
        )
        for idx in ranked_indices
    ]

    return KeywordSearchResponse(
        query=trimmed_query,
        items=items,
        total_count=len(items),
        expanded_keywords=list(expanded_terms),
    )
