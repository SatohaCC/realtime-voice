from __future__ import annotations

import hashlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.clients.keyword_expander_client import (
    LangChainKeywordExpanderClient,
    parse_expanded_keywords,
)
from app.clients.package_insert_store_client import InMemoryPackageInsertStore
from app.main import app as backend_app
from app.routers.dependencies import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.services import package_insert_service
from app.services.pmda_xml_service import PmdaXmlError, parse_pmda_xml


def _make_pmda_xml(
    body: str,
    *,
    company: str = "123456",
    insert_no: str = "0001",
    year_month: str = "2026-10",
    version: str = "2",
    brand_name: str = "テスト錠10mg",
    yj_code: str = "1111111F1011",
    generic_name: str = "テスト有効成分",
    prefix: str = '<?xml version="1.0" encoding="UTF-8"?>',
    encoding: str = "utf-8",
) -> bytes:
    xml_text = (
        f"{prefix}"
        '<PackIns drugType="Medicine">'
        f"<CompanyIdentifier>{company}</CompanyIdentifier>"
        f"<PackageInsertNo>{insert_no}</PackageInsertNo>"
        "<DateOfPreparationOrRevision>"
        '<PreparationOrRevision id="今回">'
        f"<YearMonth>{year_month}</YearMonth>"
        f"<Version>{version}</Version>"
        "</PreparationOrRevision>"
        "</DateOfPreparationOrRevision>"
        f"<GenericName><Lang>{generic_name}</Lang></GenericName>"
        "<ApprovalEtc>"
        '<DetailBrandName id="BR1">'
        f"<ApprovalBrandName><Lang>{brand_name}</Lang></ApprovalBrandName>"
        f"<BrandCode><YJCode>{yj_code}</YJCode></BrandCode>"
        "</DetailBrandName>"
        "</ApprovalEtc>"
        f"{body}"
        "</PackIns>"
    )
    return xml_text.encode(encoding)


def _sample_body() -> str:
    return (
        '<Warnings id="sec1"><Detail>'
        "<Lang>重篤な肝障害があらわれることがある。</Lang></Detail></Warnings>"
        '<ContraIndications id="sec2"><Detail>'
        "<Lang>本剤の成分に対し過敏症の既往歴のある患者</Lang></Detail></ContraIndications>"
        '<Interactions id="sec10"><ContraIndicatedCombinations id="sec10_1">'
        "<Drug><DrugName><Lang>併用禁忌薬X</Lang></DrugName>"
        "<ClinSymptomsAndMeasures><Lang>悪心・嘔吐が増強する</Lang></ClinSymptomsAndMeasures>"
        "<MechanismAndRiskFactors><Lang>CYP3A4阻害</Lang></MechanismAndRiskFactors></Drug>"
        "</ContraIndicatedCombinations></Interactions>"
        '<AdverseEvents id="sec11"><SeriousAdverseEvents id="sec11_1">'
        '<Category id="cat1"><Lang>消化器</Lang></Category>'
        '<Frequency id="freq1"><Lang>1%未満</Lang></Frequency>'
        '<AdverseReactionDescription categoryRef="cat1" frequencyRef="freq1">'
        "<Lang>激しい悪心及び嘔吐</Lang></AdverseReactionDescription>"
        "</SeriousAdverseEvents></AdverseEvents>"
    )


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "utf-16-le", "cp932"])
def test_parse_pmda_xml_supports_declared_encodings(encoding: str) -> None:
    """UTF-8 / UTF-16 / CP932 等の PMDA XML を正しく解析し検索単位を生成する。"""
    decl = (
        "UTF-16" if encoding.startswith("utf-16") else "CP932" if encoding == "cp932" else "UTF-8"
    )
    source = _make_pmda_xml(
        _sample_body(),
        prefix=f'<?xml version="1.0" encoding="{decl}"?>',
        encoding=encoding,
    )
    parsed = parse_pmda_xml(source, filename="sample.xml")
    assert parsed.document_id == "123456_0001"
    assert parsed.source_sha256 == hashlib.sha256(source).hexdigest()
    assert parsed.revised_at == "2026-10"
    assert parsed.yj_codes == ("1111111F1011",)
    assert parsed.section_count >= 5

    sec_codes = {unit.section_code for unit in parsed.search_units}
    assert {"1", "2", "10.1", "11.1"} <= sec_codes
    sec10_1 = next(u for u in parsed.search_units if u.section_code == "10.1")
    assert "<table>" in sec10_1.text
    assert "併用禁忌薬X" in sec10_1.text
    sec11_1 = next(u for u in parsed.search_units if u.section_code == "11.1")
    assert "消化器" in sec11_1.text
    assert "1%未満" in sec11_1.text


@pytest.mark.parametrize(
    ("source", "expected_code"),
    [
        (b"", "empty_source"),
        (
            b'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE PackIns><PackIns/>',
            "xml_forbidden_declaration",
        ),
        (
            _make_pmda_xml(
                '<Warnings xmlns:xi="http://www.w3.org/2001/XInclude">'
                '<xi:include href="https://example.invalid/xinclude.xml"/></Warnings>'
            ),
            "xml_forbidden_xinclude",
        ),
        (b"<PackIns", "xml_parse_error"),
        (
            b'<PackIns drugType="Medicine"><CompanyIdentifier>1</CompanyIdentifier>'
            b"<PackageInsertNo>2</PackageInsertNo></PackIns>",
            "missing_yj_code",
        ),
    ],
)
def test_parse_pmda_xml_rejects_unsafe_or_invalid_inputs(source: bytes, expected_code: str) -> None:
    """DTD・XInclude・破損 XML・必須メタデータ欠落を安全に拒否する。"""
    with pytest.raises(PmdaXmlError) as caught:
        parse_pmda_xml(source)
    assert caught.value.code == expected_code


def test_store_lifecycle_revision_rules_and_chunk_upload() -> None:
    """改訂年月比較・同改訂競合(409)・旧版削除・古い版保護・分割アップロードを検証する。"""
    store = InMemoryPackageInsertStore()

    xml_v1 = _make_pmda_xml(_sample_body(), year_month="2026-08", version="1")
    res1, created1 = package_insert_service.import_package_insert_xml(xml_v1, "v1.xml", store=store)
    assert created1 is True
    assert res1.status == "active"
    assert res1.active_yj_codes == ["1111111F1011"]

    # 同一原本の再送は冪等
    res1_again, created1_again = package_insert_service.import_package_insert_xml(
        xml_v1, "v1.xml", store=store
    )
    assert created1_again is False
    assert res1_again.reused is True
    assert res1_again.registration_sequence == res1.registration_sequence

    # 同一改訂年月の別原本は 409 競合
    xml_conflict = _make_pmda_xml(
        _sample_body() + "<Package><Detail><Lang>別包装</Lang></Detail></Package>",
        year_month="2026-08",
        version="1b",
    )
    with pytest.raises(package_insert_service.PackageInsertServiceError) as conflict_err:
        package_insert_service.import_package_insert_xml(xml_conflict, "conflict.xml", store=store)
    assert conflict_err.value.status_code == 409
    assert conflict_err.value.code == "same_revision_conflict"

    # より新しい改訂年月で置き換え（分割アップロード経由でテスト）
    xml_v2 = _make_pmda_xml(_sample_body(), year_month="2026-11", version="2")
    sha_v2 = hashlib.sha256(xml_v2).hexdigest()
    upload = package_insert_service.start_package_insert_upload(
        filename="v2.xml", byte_size=len(xml_v2), source_sha256=sha_v2, store=store
    )
    half = len(xml_v2) // 2
    package_insert_service.upload_package_insert_part(
        upload_id=upload.upload_id, part_index=0, content=xml_v2[:half], store=store
    )
    package_insert_service.upload_package_insert_part(
        upload_id=upload.upload_id, part_index=1, content=xml_v2[half:], store=store
    )
    res2, created2 = package_insert_service.complete_package_insert_upload(
        upload_id=upload.upload_id, store=store
    )
    assert created2 is True
    assert res2.status == "active"
    assert res2.replaced_yj_codes == ["1111111F1011"]
    assert res2.deleted_version_ids == [f"{res1.document_id}:{res1.source_sha256}"]

    # 削除済み旧版の再送でも復活しない
    res1_replay, _ = package_insert_service.import_package_insert_xml(xml_v1, "v1.xml", store=store)
    assert res1_replay.reused is True
    assert res1_replay.status == "superseded"
    assert res1_replay.artifacts_deleted is True

    # より古い改訂年月を後から登録しても active にならない
    xml_old = _make_pmda_xml(_sample_body(), year_month="2025-01", version="0")
    res_old, created_old = package_insert_service.import_package_insert_xml(
        xml_old, "old.xml", store=store
    )
    assert created_old is True
    assert res_old.status == "superseded"
    assert res_old.active_yj_codes == []

    history = package_insert_service.list_package_insert_imports(limit=2, offset=0, store=store)
    assert history.total_count == 3
    assert [item.registration_sequence for item in history.items] == [3, 2]


class _FakeExpander:
    async def expand_keywords(self, _query: str) -> tuple[str, ...]:
        return ("悪心", "嘔吐")


@pytest.mark.anyio
async def test_search_package_inserts_with_yj_filter_and_llm_expansion() -> None:
    """YJ コード絞り込みと LLM 類義語拡張を組み合わせて根拠検索できる。"""
    store = InMemoryPackageInsertStore()
    xml_a = _make_pmda_xml(
        _sample_body(),
        company="100001",
        insert_no="A1",
        brand_name="テスト胃薬",
        yj_code="2329001F1011",
    )
    xml_b = _make_pmda_xml(
        '<Warnings id="sec1"><Detail><Lang>眠気に注意すること。</Lang></Detail></Warnings>',
        company="100002",
        insert_no="B1",
        brand_name="テスト鎮痛薬",
        yj_code="1141007F1011",
    )
    package_insert_service.import_package_insert_xml(xml_a, "a.xml", store=store)
    package_insert_service.import_package_insert_xml(xml_b, "b.xml", store=store)

    # 通常の絞り込みなし検索で「吐き気」を類義語拡張して「悪心」にヒットする
    result = await package_insert_service.search_package_inserts(
        "吐き気",
        expand=True,
        store=store,
        expander=_FakeExpander(),
    )
    assert result.expanded_keywords == ["悪心", "嘔吐"]
    assert result.total_count >= 1
    assert all(item.document_id == "100001_A1" for item in result.items)

    # YJ コードで B のみに絞るとヒット 0 件になる
    filtered = await package_insert_service.search_package_inserts(
        "吐き気",
        yj_codes=["1141007F1011"],
        expand=True,
        store=store,
        expander=_FakeExpander(),
    )
    assert filtered.total_count == 0


def test_package_insert_routes_require_auth_and_handle_end_to_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """認証保護（401）と取り込み・履歴・医薬品一覧・検索 API の往復を検証する。"""
    store = InMemoryPackageInsertStore()
    monkeypatch.setattr(package_insert_service, "get_default_package_insert_store", lambda: store)
    monkeypatch.setattr(
        package_insert_service,
        "get_default_keyword_expander",
        lambda: _FakeExpander(),
    )

    client = TestClient(backend_app)

    # 未認証リクエストはすべて 401
    assert client.get("/api/package-insert-imports").status_code == 401
    assert client.get("/api/medicines").status_code == 401
    assert client.get("/api/search", params={"q": "悪心"}).status_code == 401
    assert (
        client.post(
            "/api/package-insert-imports",
            files={"file": ("sample.xml", b"<PackIns/>", "application/xml")},
        ).status_code
        == 401
    )

    async def _override_user() -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id="user-1",
            email="pharmacist@example.com",
            role="authenticated",
            expires_at=9_999_999_999,
        )

    backend_app.dependency_overrides[get_current_user] = _override_user
    try:
        xml_bytes = _make_pmda_xml(_sample_body())
        post_res = client.post(
            "/api/package-insert-imports",
            files={"file": ("sample.xml", xml_bytes, "application/xml")},
        )
        assert post_res.status_code == 201
        assert post_res.headers["location"].startswith("/api/package-insert-imports/123456_0001/")
        payload: dict[str, Any] = post_res.json()
        assert payload["status"] == "active"
        assert payload["reused"] is False

        # 同一原本再送は 200
        replay_res = client.post(
            "/api/package-insert-imports",
            files={"file": ("sample.xml", xml_bytes, "application/xml")},
        )
        assert replay_res.status_code == 200
        assert replay_res.json()["reused"] is True

        # 履歴・詳細・医薬品一覧・検索
        list_res = client.get("/api/package-insert-imports")
        assert list_res.status_code == 200
        assert list_res.json()["total_count"] == 1

        detail_res = client.get(post_res.headers["location"])
        assert detail_res.status_code == 200
        assert detail_res.json()["document_id"] == "123456_0001"

        meds_res = client.get("/api/medicines")
        assert meds_res.status_code == 200
        assert meds_res.json()["items"][0]["yj_codes"] == ["1111111F1011"]

        search_res = client.get("/api/search", params={"q": "吐き気", "expand": "true"})
        assert search_res.status_code == 200
        search_json = search_res.json()
        assert search_json["expanded_keywords"] == ["悪心", "嘔吐"]
        assert search_json["total_count"] >= 1
    finally:
        backend_app.dependency_overrides.clear()


def test_keyword_expander_defaults_and_parser() -> None:
    """Google GenAI 最小デッドライン(10s)を満たす設定と類義語 JSON パースを検証する。"""
    client = LangChainKeywordExpanderClient(provider="google_genai", model="gemini-3.5-flash-lite")
    assert client._timeout_seconds >= 10.0
    assert parse_expanded_keywords('```json\n["悪心", "嘔吐", "吐き気"]\n```', "吐き気") == (
        "悪心",
        "嘔吐",
    )
