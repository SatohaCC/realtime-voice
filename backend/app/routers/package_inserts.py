from __future__ import annotations

import asyncio
from email.parser import BytesParser
from email.policy import default
from typing import Annotated
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.core.config import settings
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.schemas.package_insert import (
    ImportListResponse,
    KeywordSearchResponse,
    MedicineListResponse,
    PackageInsertImportResponse,
    UploadRequest,
    UploadResponse,
)
from app.services.package_insert_service import (
    PackageInsertServiceError,
    complete_package_insert_upload,
    get_package_insert_import,
    import_package_insert_xml,
    list_package_insert_imports,
    list_registered_medicines,
    search_package_inserts,
    start_package_insert_upload,
    upload_package_insert_part,
)

BODY_LIMIT = 11 * 1024 * 1024

router = APIRouter(tags=["package-inserts"])


def _http_error(exc: PackageInsertServiceError) -> HTTPException:
    detail: dict[str, object] = {
        "code": exc.code,
        "message": exc.message,
        "phase": exc.phase,
    }
    if exc.conflicts:
        detail["conflicts"] = exc.conflicts
    return HTTPException(status_code=exc.status_code, detail=detail)


async def _read_bounded_body(request: Request, limit: int) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "request_too_large",
                    "message": "受信データサイズが上限を超えています。",
                    "phase": "validation",
                },
            )
        body.extend(chunk)
    return bytes(body)


def _extract_multipart_file(body: bytes, content_type: str) -> tuple[str, bytes]:
    raw_headers = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("latin-1")
    message = BytesParser(policy=default).parsebytes(raw_headers + body)
    if not message.is_multipart():
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_multipart",
                "message": "multipart/form-data 形式が不正です。",
                "phase": "validation",
            },
        )
    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue
        field_name = part.get_param("name", header="content-disposition")
        if field_name != "file":
            continue
        filename = part.get_filename() or "source.xml"
        payload = part.get_payload(decode=True)
        raw_bytes = payload if isinstance(payload, bytes) else b""
        return filename, raw_bytes

    raise HTTPException(
        status_code=422,
        detail={
            "code": "missing_file",
            "message": "XML ファイル（file フィールド）を指定してください。",
            "phase": "validation",
        },
    )


def _location_header(result: PackageInsertImportResponse) -> dict[str, str]:
    doc = quote(result.document_id, safe="")
    sha = quote(result.source_sha256, safe="")
    return {"Location": f"/api/package-insert-imports/{doc}/{sha}"}


@router.post(
    "/api/package-insert-imports/uploads",
    response_model=UploadResponse,
    status_code=201,
)
async def start_upload(
    payload: UploadRequest,
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> UploadResponse:
    """大容量 XML 用の分割アップロードセッションを開始する。"""
    try:
        return await asyncio.to_thread(
            start_package_insert_upload,
            filename=payload.filename,
            byte_size=payload.byte_size,
            source_sha256=payload.source_sha256,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None


@router.post(
    "/api/package-insert-imports/uploads/{upload_id}/parts/{index}",
    status_code=204,
)
async def upload_part(
    upload_id: str,
    index: int,
    request: Request,
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> Response:
    """分割アップロードの 1 パートを受信して保存する。"""
    content = await _read_bounded_body(request, settings.package_insert_chunk_bytes)
    try:
        await asyncio.to_thread(
            upload_package_insert_part,
            upload_id=upload_id,
            part_index=index,
            content=content,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None
    return Response(status_code=204)


@router.post(
    "/api/package-insert-imports/uploads/{upload_id}/complete",
    response_model=PackageInsertImportResponse,
)
async def complete_upload(
    upload_id: str,
    response: Response,
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> PackageInsertImportResponse:
    """分割アップロードを結合して添付文書を登録する。"""
    try:
        result, created = await asyncio.to_thread(
            complete_package_insert_upload,
            upload_id=upload_id,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None
    response.status_code = 201 if created else 200
    response.headers.update(_location_header(result))
    return result


@router.post(
    "/api/package-insert-imports",
    response_model=PackageInsertImportResponse,
)
async def import_package_insert(
    request: Request,
    response: Response,
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> PackageInsertImportResponse:
    """PMDA 電子添文 XML を受信し、解析・検索単位構築・登録を実行する。"""
    body = await _read_bounded_body(request, BODY_LIMIT)
    content_type = request.headers.get("content-type", "")
    lower_ct = content_type.lower()

    if lower_ct.startswith("multipart/form-data"):
        filename, xml_bytes = _extract_multipart_file(body, content_type)
    elif (
        lower_ct.startswith("application/xml")
        or lower_ct.startswith("text/xml")
        or lower_ct.startswith("application/octet-stream")
        or not lower_ct
    ):
        raw_name = request.headers.get("x-file-name", "").strip()
        filename = unquote(raw_name) if raw_name else "source.xml"
        xml_bytes = body
    else:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "unsupported_media_type",
                "message": "multipart/form-data または XML 形式で送信してください。",
                "phase": "validation",
            },
        )

    try:
        result, created = await asyncio.to_thread(
            import_package_insert_xml,
            xml_bytes,
            filename,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None

    response.status_code = 201 if created else 200
    response.headers.update(_location_header(result))
    return result


@router.get(
    "/api/package-insert-imports",
    response_model=ImportListResponse,
)
async def list_imports(
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ImportListResponse:
    """登録済みの添付文書取り込み履歴一覧を取得する。"""
    try:
        return await asyncio.to_thread(
            list_package_insert_imports,
            limit=limit,
            offset=offset,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/api/package-insert-imports/{document_id}/{source_sha256}",
    response_model=PackageInsertImportResponse,
)
async def get_import_detail(
    document_id: str,
    source_sha256: str,
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> PackageInsertImportResponse:
    """指定した添付文書バージョンの登録結果を再取得する。"""
    try:
        return await asyncio.to_thread(
            get_package_insert_import,
            document_id=document_id,
            source_sha256=source_sha256,
        )
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/api/medicines",
    response_model=MedicineListResponse,
)
async def list_medicines(
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> MedicineListResponse:
    """現在検索対象として有効な医薬品一覧を取得する。"""
    try:
        return await asyncio.to_thread(list_registered_medicines)
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/api/search",
    response_model=KeywordSearchResponse,
)
async def search_inserts(
    _current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    q: Annotated[
        str,
        Query(
            min_length=1,
            max_length=200,
            description="検索キーワード（空白区切りで複数指定可）",
        ),
    ],
    yj_codes: Annotated[
        list[str] | None,
        Query(description="絞り込み対象の医薬品 YJ コード"),
    ] = None,
    expand: Annotated[
        bool,
        Query(description="LLM による医学的同義語・類義語拡張を有効にするか"),
    ] = False,
) -> KeywordSearchResponse:
    """登録済み添付文書からキーワードに合致する根拠単位を検索する。"""
    try:
        return await search_package_inserts(q, yj_codes or (), expand=expand)
    except PackageInsertServiceError as exc:
        raise _http_error(exc) from None
