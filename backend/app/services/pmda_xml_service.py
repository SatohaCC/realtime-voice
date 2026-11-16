from __future__ import annotations

import hashlib
import html
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from typing import Any, Never
from xml.parsers import expat

from app.core.config import settings
from app.schemas.package_insert import (
    ImportedProductResponse,
    ImportedRevisionResponse,
    ImportWarningResponse,
)

MAX_XML_DEPTH = 256
MAX_XML_ELEMENTS = 200_000

_SUPERSCRIPTS = str.maketrans("0123456789+-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻")
_YJ_CODE_RE = re.compile(r"^[0-9A-Za-z]{12}$")
_YEAR_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

_HEADER_TAGS = frozenset(
    (
        "ApprovalEtc",
        "CompanyIdentifier",
        "DateOfPreparationOrRevision",
        "GenericName",
        "PackageInsertNo",
        "Sccj",
        "TherapeuticClassification",
    )
)
_REFERENCE_TAGS = frozenset(("CommentRef", "HeaderRef", "ReferenceBookRef"))
_ATOMIC_UNITS: dict[str, str] = {
    "Drug": "interaction_row",
    "AdverseReactionDescription": "adverse_reaction_cell",
    "SimpTblRow": "table_row",
    "Reference": "literature_reference",
    "OtherInformation": "other_information",
    "Graphic": "graphic",
}

_SECTION_TITLES: dict[str, str] = {
    "1": "警告",
    "2": "禁忌",
    "3": "組成・性状",
    "3.1": "組成",
    "3.2": "製剤の性状",
    "4": "効能又は効果",
    "5": "効能又は効果に関連する注意",
    "6": "用法及び用量",
    "7": "用法及び用量に関連する注意",
    "8": "重要な基本的注意",
    "9": "特定の背景を有する患者に関する注意",
    "9.1": "合併症・既往歴等のある患者",
    "9.2": "腎機能障害患者",
    "9.3": "肝機能障害患者",
    "9.4": "生殖能を有する者",
    "9.5": "妊婦",
    "9.6": "授乳婦",
    "9.7": "小児等",
    "9.8": "高齢者",
    "10": "相互作用",
    "10.1": "併用禁忌",
    "10.2": "併用注意",
    "11": "副作用",
    "11.1": "重大な副作用",
    "11.2": "その他の副作用",
    "12": "臨床検査結果に及ぼす影響",
    "13": "過量投与",
    "14": "適用上の注意",
    "15": "その他の注意",
    "15.1": "臨床使用に基づく情報",
    "15.2": "非臨床試験に基づく情報",
    "16": "薬物動態",
    "16.1": "血中濃度",
    "16.2": "吸収",
    "16.3": "分布",
    "16.4": "代謝",
    "16.5": "排泄",
    "16.6": "特定の背景を有する患者",
    "16.7": "薬物相互作用",
    "16.8": "その他",
    "17": "臨床成績",
    "17.1": "有効性及び安全性に関する試験",
    "17.2": "製造販売後調査等",
    "17.3": "その他",
    "18": "薬効薬理",
    "18.1": "作用機序",
    "19": "有効成分に関する理化学的知見",
    "20": "取扱い上の注意",
    "21": "承認条件",
    "22": "包装",
    "23": "主要文献",
    "24": "文献請求先及び問い合わせ先",
    "25": "保険給付上の注意",
    "26": "製造販売業者等",
}

_XML_TAG_TO_SECTION: dict[str, str] = {
    "Warnings": "1",
    "ContraIndications": "2",
    "CompositionAndProperty": "3",
    "Composition": "3.1",
    "Property": "3.2",
    "IndicationsOrEfficacy": "4",
    "EfficacyRelatedPrecautions": "5",
    "InfoDoseAdmin": "6",
    "InfoPrecautionsDosage": "7",
    "ImportantPrecautions": "8",
    "UseInSpecificPopulations": "9",
    "UseInPatientsWithComplicationsOrHistoryOfDiseasesEtc": "9.1",
    "PatientsWithRenalImpairment": "9.2",
    "PatientsWithHepaticImpairment": "9.3",
    "MalesAndFemalesOfReproductivePotential": "9.4",
    "UseInPregnant": "9.5",
    "UseInNursing": "9.6",
    "PediatricUse": "9.7",
    "UseInTheElderly": "9.8",
    "Interactions": "10",
    "ContraIndicatedCombinations": "10.1",
    "PrecautionsForCombinations": "10.2",
    "AdverseEvents": "11",
    "SeriousAdverseEvents": "11.1",
    "OtherAdverseEvents": "11.2",
    "InfluenceOnLaboratoryValues": "12",
    "EffectsOnLaboratoryTests": "12",
    "OverDosage": "13",
    "PrecautionsForApplication": "14",
    "OtherPrecautions": "15",
    "InformationBasedOnClinicalUse": "15.1",
    "InformationBasedOnNonClinicalUse": "15.2",
    "Pharmacokinetics": "16",
    "BloodLevel": "16.1",
    "Absorption": "16.2",
    "Distribution": "16.3",
    "Metabolism": "16.4",
    "Excretion": "16.5",
    "SpecificPopulation": "16.6",
    "DrugAndDrugInteractions": "16.7",
    "ResultsOfClinicalTrials": "17",
    "EfficacyAndSafety": "17.1",
    "PostMarketingSurveillance": "17.2",
    "EfficacyPharmacology": "18",
    "MechanismOfAction": "18.1",
    "PhyschemOfActIngredients": "19",
    "PrecautionsForHandling": "20",
    "ConditionsOfApproval": "21",
    "Package": "22",
    "MainLiterature": "23",
    "AddresseeOfLiteratureRequest": "24",
    "AttentionOfInsurance": "25",
    "PrecautionsForInsuranceCoverage": "25",
    "NameAddressManufact": "26",
}

_XML_CONTEXT_TO_SECTION: dict[tuple[str, str], str] = {
    ("Pharmacokinetics", "OtherInformation"): "16.8",
    ("ResultsOfClinicalTrials", "OtherInformation"): "17.3",
}

_INTERACTION_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("drug_name", "薬剤名", "DrugName"),
    ("clinical_symptoms_and_measures", "臨床症状・措置方法", "ClinSymptomsAndMeasures"),
    ("mechanism_and_risk_factors", "機序・危険因子", "MechanismAndRiskFactors"),
)


class PmdaXmlError(Exception):
    """PMDA 電子添文 XML の解析・検証エラー。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 422,
        phase: str = "validation",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.phase = phase


@dataclass(frozen=True)
class ParsedSearchUnit:
    """XML から生成された検索単位。"""

    unit_id: str
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
class ParsedPackageInsert:
    """XML 解析と検証を通過した添付文書モデル。"""

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
    search_units: tuple[ParsedSearchUnit, ...]


def normalize_search_text(text: str) -> str:
    """NFKC 正規化・小文字化・空白正規化を行い、検索用テキストを生成する。"""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def _tag_name(element: ET.Element) -> str:
    if element.tag is ET.ProcessingInstruction:
        return "#processing_instruction"
    if element.tag is ET.Comment:
        return "#comment"
    return str(element.tag).rsplit("}", 1)[-1]


def _decode_xml_bytes(source: bytes) -> str:
    if source.startswith((b"\xff\xfe", b"\xfe\xff")):
        return source.decode("utf-16")
    if source.startswith(b"<\x00?\x00"):
        return source.decode("utf-16-le")
    if source.startswith(b"\x00<\x00?"):
        return source.decode("utf-16-be")
    declaration = re.match(
        rb'(?:\xef\xbb\xbf)?<\?xml\s[^?]*encoding\s*=\s*[\'"]([^\'"]+)[\'"]',
        source[:1024],
    )
    encoding = declaration.group(1).decode("ascii") if declaration else "utf-8-sig"
    if encoding.lower().replace("_", "-").startswith("utf-16"):
        raise UnicodeError("UTF-16 宣言に対して UTF-16 バイト列ではありません。")
    return source.decode(encoding)


def _parse_xml_safely(source: bytes) -> ET.Element:
    if not source:
        raise PmdaXmlError("empty_source", "XML ファイルが空です。")
    if len(source) > settings.package_insert_max_bytes:
        raise PmdaXmlError(
            "source_size_limit",
            "XML ファイルサイズが上限（10MiB）を超えています。",
            status_code=413,
        )
    if source.startswith((b"PK\x03\x04", b"\x1f\x8b")) or (
        b"\x00" in source[:128]
        and not source.startswith((b"\xff\xfe", b"\xfe\xff", b"<\x00", b"\x00<"))
    ):
        raise PmdaXmlError(
            "unsupported_input",
            "対応していないファイル形式です。PMDA の XML ファイルを選択してください。",
            status_code=415,
        )
    try:
        text = _decode_xml_bytes(source)
    except UnicodeError, LookupError:
        raise PmdaXmlError("xml_parse_error", "XML の文字エンコーディングが不正です。") from None

    if not text.lstrip("\ufeff \r\n\t").startswith("<"):
        raise PmdaXmlError(
            "unsupported_input",
            "XML 形式のファイルではありません。",
            status_code=415,
        )

    declared = re.match(r'\ufeff?<\?xml\s[^?]*encoding\s*=\s*[\'"]([^\'"]+)[\'"]', text[:1024])
    utf16_bytes = source.startswith((b"\xff\xfe", b"\xfe\xff", b"<\x00", b"\x00<"))
    if declared and declared.group(1).lower().replace("_", "-").startswith("utf-16") != utf16_bytes:
        raise PmdaXmlError(
            "xml_parse_error",
            "XML 宣言のエンコーディング指定と実データ形式が一致しません。",
        )

    parser = expat.ParserCreate()
    depth = 0
    count = 0

    def on_start(_name: str, _attributes: dict[str, str]) -> None:
        nonlocal depth, count
        depth += 1
        count += 1
        if depth > MAX_XML_DEPTH:
            raise PmdaXmlError("xml_depth_limit", "XML の階層深さが上限を超えています。")
        if count > MAX_XML_ELEMENTS:
            raise PmdaXmlError("xml_element_limit", "XML の要素数が上限を超えています。")

    def on_end(_name: str) -> None:
        nonlocal depth
        depth -= 1

    def on_forbidden(*_args: object) -> Never:
        raise PmdaXmlError(
            "xml_forbidden_declaration",
            "DTD および外部エンティティ宣言を含む XML は受け付けられません。",
        )

    def on_external_entity(*_args: object) -> int:
        on_forbidden()

    parser.StartElementHandler = on_start
    parser.EndElementHandler = on_end
    parser.StartDoctypeDeclHandler = on_forbidden
    parser.EntityDeclHandler = on_forbidden
    parser.ExternalEntityRefHandler = on_external_entity

    try:
        parser.Parse(text, True)
        root = ET.fromstring(
            text,
            parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True)),
        )
    except PmdaXmlError:
        raise
    except expat.ExpatError, ET.ParseError, ValueError:
        raise PmdaXmlError("xml_parse_error", "XML の構文解析に失敗しました。") from None

    if any(
        isinstance(element.tag, str) and element.tag.startswith("{http://www.w3.org/2001/XInclude}")
        for element in root.iter()
    ):
        raise PmdaXmlError(
            "xml_forbidden_xinclude",
            "XInclude を含む XML はサポートされていません。",
        )
    return root


def _build_paths(root: ET.Element) -> tuple[dict[ET.Element, ET.Element], dict[ET.Element, str]]:
    parents: dict[ET.Element, ET.Element] = {}
    paths = {root: f"/{_tag_name(root)}[1]"}

    def walk(element: ET.Element) -> None:
        counts: Counter[str] = Counter()
        for child in element:
            name = _tag_name(child)
            counts[name] += 1
            parents[child] = element
            paths[child] = f"{paths[element]}/{name}[{counts[name]}]"
            walk(child)

    walk(root)
    return parents, paths


def _direct_child(element: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in element if _tag_name(child) == name), None)


def _find_path(element: ET.Element, *names: str) -> ET.Element | None:
    current: ET.Element | None = element
    for name in names:
        if current is None:
            return None
        current = _direct_child(current, name)
    return current


def _render_inline(element: ET.Element) -> str:
    tag = _tag_name(element)
    if tag == "#processing_instruction":
        return "\ue000" if (element.text or "").split(" ", 1)[0] == "enter" else ""
    if tag in _REFERENCE_TAGS:
        return ""
    if tag in {"InlineGraphic", "GraphicBody"}:
        return f"［図:{element.attrib.get('gfname', '')}］"
    if tag == "Sup":
        return _render_children(element).translate(_SUPERSCRIPTS)
    if tag == "Sub":
        return "_{" + _render_children(element) + "}"
    return _render_children(element)


def _render_children(element: ET.Element) -> str:
    pieces = [element.text or ""]
    for child in element:
        pieces.append(_render_inline(child))
        tail = child.tail or ""
        if _tag_name(child) in _REFERENCE_TAGS and re.fullmatch(r"[\s,，、]*", tail):
            tail = ""
        pieces.append(tail)
    return "".join(pieces)


def _text_of(element: ET.Element | None) -> str:
    if element is None:
        return ""
    raw = _render_inline(element)
    chunks = [re.sub(r"\s+", " ", part).strip() for part in raw.split("\ue000")]
    return "\n".join(chunk for chunk in chunks if chunk)


def _text_lines(element: ET.Element | None) -> list[str]:
    if element is None:
        return []
    lines: list[str] = []
    for child in element.iter():
        if _tag_name(child) == "Lang":
            value = _text_of(child)
            if value:
                lines.append(value)
    if not lines:
        fallback = _text_of(element)
        if fallback:
            lines.append(fallback)
    return lines


def _field(element: ET.Element, *names: str) -> str | None:
    value = _text_of(_find_path(element, *names))
    return value or None


def _section_definition(
    element: ET.Element, parents: dict[ET.Element, ET.Element]
) -> tuple[str, str] | None:
    name = _tag_name(element)
    code = _XML_TAG_TO_SECTION.get(name)
    if code is not None:
        return code, _SECTION_TITLES[code]

    ancestor = parents.get(element)
    while ancestor is not None:
        ancestor_name = _tag_name(ancestor)
        ctx_code = _XML_CONTEXT_TO_SECTION.get((ancestor_name, name))
        if ctx_code is not None:
            return ctx_code, _SECTION_TITLES[ctx_code]
        if ancestor_name in _XML_TAG_TO_SECTION:
            return None
        ancestor = parents.get(ancestor)
    return None


def _make_section_index(
    root: ET.Element,
    parents: dict[ET.Element, ET.Element],
    pmda_url: str,
) -> tuple[list[dict[str, Any]], dict[ET.Element, dict[str, Any]]]:
    index: list[dict[str, Any]] = []
    by_element: dict[ET.Element, dict[str, Any]] = {}
    for element in root.iter():
        definition = _section_definition(element, parents)
        if definition is None:
            continue
        code, title = definition
        xml_id = element.attrib.get("id")
        record = {
            "code": code,
            "title": title,
            "xml_id": xml_id,
            "url": f"{pmda_url}#{xml_id}" if xml_id else pmda_url,
        }
        index.append(record)
        by_element[element] = record
    return index, by_element


def _nearest_section(
    element: ET.Element,
    parents: dict[ET.Element, ET.Element],
    section_by_element: dict[ET.Element, dict[str, Any]],
) -> dict[str, Any] | None:
    current: ET.Element | None = element
    while current is not None:
        if current in section_by_element:
            return section_by_element[current]
        current = parents.get(current)
    return None


def _context_labels(element: ET.Element, parents: dict[ET.Element, ET.Element]) -> list[str]:
    labels: list[str] = []
    current = parents.get(element)
    while current is not None:
        if _tag_name(current) == "Item":
            label = _text_of(_direct_child(current, "Header"))
            if label:
                labels.append(label)
        current = parents.get(current)
    return list(reversed(labels))


def _scoped_products(
    element: ET.Element,
    parts: list[ET.Element],
    parents: dict[ET.Element, ET.Element],
    products: list[dict[str, str | None]],
    products_by_id: dict[str, dict[str, str | None]],
    scope: list[str],
) -> list[dict[str, str | None]]:
    def referenced(el: ET.Element) -> list[dict[str, str | None]]:
        ref = el.attrib.get("brandRef") or el.attrib.get("productRef")
        if not ref:
            return []
        return [products_by_id[pid] for pid in re.split(r"[\s,]+", ref) if pid in products_by_id]

    current: ET.Element | None = element
    while current is not None:
        matched = referenced(current)
        if matched:
            return matched
        current = parents.get(current)

    for part in parts:
        for child in part.iter():
            matched = referenced(child)
            if matched:
                return matched

    if len(products) > 1:
        matched = [
            p
            for p in products
            if p.get("brand_name") and any(str(p["brand_name"]) in label for label in scope)
        ]
        if matched:
            return matched
    return products


def _table_row(values: list[str], attributes: list[dict[str, str]] | None = None) -> str:
    cells: list[str] = []
    for index, value in enumerate(values):
        attrs = attributes[index] if attributes is not None else {}
        spans = "".join(
            f' {target}="{int(attrs[source])}"'
            for source, target in (("rspan", "rowspan"), ("cspan", "colspan"))
            if source in attrs and attrs[source].isdigit()
        )
        cells.append(f'<td{spans} style="white-space: pre-wrap">{html.escape(value)}</td>')
    return "<tr>" + "".join(cells) + "</tr>"


def _render_section_text(
    fragments: list[dict[str, Any]],
    products: list[dict[str, str | None]],
) -> str:
    names = {p.get("yj_code"): p.get("brand_name") or "" for p in products}
    blocks: list[str] = []
    last_table: str | None = None
    last_codes: tuple[str, ...] | None = None
    last_scope: tuple[str, ...] | None = None

    for fragment in fragments:
        codes = tuple(fragment["product_yj_codes"])
        if len(products) > 1 and codes != last_codes:
            labels = [f"{names.get(code, '')} [YJ: {code}]" for code in codes]
            blocks.append("### 対象製品: " + " / ".join(labels))
            last_table = None
        last_codes = codes

        scope = tuple(fragment["context_labels"])
        if scope != last_scope:
            if scope:
                blocks.append("### " + " / ".join(scope))
            last_table = None
        last_scope = scope

        kind = fragment["kind"]
        headings = ""
        table_key: str | None = None
        row = ""
        if kind == "interaction_row":
            headings = _table_row([col[1] for col in _INTERACTION_COLUMNS])
            row = _table_row([fragment["columns"][col[0]] for col in _INTERACTION_COLUMNS])
            table_key = kind
        elif kind == "adverse_reaction_cell":
            headings = _table_row(["分類", "頻度", "副作用"])
            row = _table_row(
                [
                    fragment["category_label"] or "",
                    fragment["frequency_label"] or "",
                    fragment["text"],
                ]
            )
            table_key = kind
        elif kind == "table_row":
            table_key = fragment["table_xml_path"]
            row = _table_row(
                [cell["text"] for cell in fragment["cells"]],
                [cell["attributes"] for cell in fragment["cells"]],
            )
        else:
            blocks.append(fragment["text"])

        if table_key is not None:
            if last_table == table_key and blocks:
                blocks[-1] = blocks[-1][:-8] + row + "</table>"
            else:
                blocks.append("<table>" + headings + row + "</table>")
        last_table = table_key

    return "\n\n".join(blocks)


def _extract_metadata(
    root: ET.Element,
) -> tuple[
    str,
    str,
    list[dict[str, str | None]],
    list[dict[str, str | None]],
    str,
]:
    if _tag_name(root) != "PackIns" or root.attrib.get("drugType") != "Medicine":
        raise PmdaXmlError(
            "unsupported_pmda_document",
            "医療用医薬品の PMDA 電子添文 XML（PackIns drugType='Medicine'）ではありません。",
        )
    insert_no = _field(root, "PackageInsertNo")
    company = _field(root, "CompanyIdentifier")
    if not insert_no or not company:
        raise PmdaXmlError(
            "missing_document_identity",
            "文書識別子（CompanyIdentifier / PackageInsertNo）が見つかりません。",
        )
    pmda_key = f"{company}_{insert_no}"
    pmda_url = f"https://www.pmda.go.jp/PmdaSearch/iyakuDetail/{pmda_key}"

    products: list[dict[str, str | None]] = []
    approval = _direct_child(root, "ApprovalEtc")
    if approval is not None:
        for brand in approval:
            if _tag_name(brand) != "DetailBrandName":
                continue
            yj = _field(brand, "BrandCode", "YJCode")
            if yj:
                yj = unicodedata.normalize("NFKC", yj).strip().upper()
            products.append(
                {
                    "xml_id": brand.attrib.get("id"),
                    "brand_name": _field(brand, "ApprovalBrandName"),
                    "yj_code": yj,
                }
            )

    valid_yj_codes = [
        p["yj_code"] for p in products if p["yj_code"] and _YJ_CODE_RE.match(p["yj_code"])
    ]
    if not valid_yj_codes:
        raise PmdaXmlError(
            "missing_yj_code",
            "有効な 12 桁の YJ コードが見つかりません。",
        )

    revisions: list[dict[str, str | None]] = []
    rev_parent = _direct_child(root, "DateOfPreparationOrRevision")
    if rev_parent is not None:
        for entry in rev_parent:
            if _tag_name(entry) == "PreparationOrRevision":
                ym = _field(entry, "YearMonth")
                if ym:
                    ym = unicodedata.normalize("NFKC", ym).strip()
                revisions.append(
                    {
                        "source_label": entry.attrib.get("id"),
                        "year_month": ym,
                        "version": _field(entry, "Version"),
                    }
                )

    valid_months = [
        str(r["year_month"])
        for r in revisions
        if r.get("year_month") and _YEAR_MONTH_RE.match(str(r["year_month"]))
    ]
    if not valid_months:
        raise PmdaXmlError(
            "missing_revision_date",
            "改訂年月（YYYY-MM）が見つからないか形式が不正です。",
        )
    generic_name = _field(root, "GenericName") or ""
    return pmda_key, pmda_url, products, revisions, generic_name


def parse_pmda_xml(source: bytes, *, filename: str = "source.xml") -> ParsedPackageInsert:
    """PMDA 電子添文 XML を安全に解析し、構造化検索単位とメタ情報を返す。"""
    root = _parse_xml_safely(source)

    ids_list = [el.attrib["id"] for el in root.iter() if "id" in el.attrib]
    if len(ids_list) != len(set(ids_list)):
        raise PmdaXmlError(
            "duplicate_reference_id",
            "XML 内の参照 ID が重複しています。",
        )

    pmda_key, pmda_url, products, revisions, generic_name = _extract_metadata(root)
    parents, paths = _build_paths(root)
    sections, section_by_element = _make_section_index(root, parents, pmda_url)

    unknown_root = [
        _tag_name(child)
        for child in root
        if _tag_name(child)
        not in _HEADER_TAGS | set(_XML_TAG_TO_SECTION) | {"#comment", "#processing_instruction"}
    ]
    if unknown_root:
        raise PmdaXmlError(
            "unmapped_root_section",
            f"未対応のルート要素が含まれています: {', '.join(unknown_root)}",
        )
    if not sections:
        raise PmdaXmlError("missing_sections", "有効な番号付き添付文書項目が見つかりません。")

    codes = [str(s["code"]) for s in sections]
    if len(codes) != len(set(codes)):
        raise PmdaXmlError("duplicate_section", "番号付きセクションが重複しています。")

    # 警告収集（参照切れ・図ファイル参照）
    id_elements = {el.attrib["id"]: el for el in root.iter() if "id" in el.attrib}
    warnings: list[ImportWarningResponse] = []
    for el in root.iter():
        if _tag_name(el) in _REFERENCE_TAGS:
            target = el.attrib.get("ref", "")
            if target and target not in id_elements:
                warnings.append(
                    ImportWarningResponse(code="unresolved_reference", reference=target)
                )
        if "gfname" in el.attrib:
            warnings.append(
                ImportWarningResponse(code="missing_figure_asset", reference=el.attrib["gfname"])
            )

    products_by_id: dict[str, dict[str, str | None]] = {
        xml_id: p for p in products if (xml_id := p.get("xml_id")) is not None
    }
    labels_by_id = {
        key: _text_of(el)
        for key, el in id_elements.items()
        if _tag_name(el) in {"Category", "Frequency"}
    }
    referenced_labels = {
        el.attrib[attr]
        for el in root.iter()
        for attr in ("categoryRef", "frequencyRef")
        if attr in el.attrib
    }

    fragments: list[dict[str, Any]] = []

    def emit(element: ET.Element, kind: str) -> None:
        section = _nearest_section(element, parents, section_by_element)
        if section is None:
            return
        text = _text_of(element)
        extra: dict[str, Any] = {}
        if kind == "interaction_row":
            cols = {
                col_id: "\n".join(_text_lines(_direct_child(element, xml_tag)))
                for col_id, _, xml_tag in _INTERACTION_COLUMNS
            }
            extra["columns"] = cols
            text = "\n".join(f"{k}: {v}" for k, v in cols.items() if v)
        elif kind == "adverse_reaction_cell":
            cat_id = element.attrib.get("categoryRef")
            freq_id = element.attrib.get("frequencyRef")
            extra["category_label"] = labels_by_id.get(cat_id) if cat_id else None
            extra["frequency_label"] = labels_by_id.get(freq_id) if freq_id else None
        elif kind == "table_row":
            cells = [child for child in element if _tag_name(child) == "SimpTblCell"]
            extra["cells"] = [
                {
                    "text": "\n".join(_text_lines(cell)),
                    "attributes": dict(cell.attrib),
                }
                for cell in cells
            ]
            table = parents.get(element)
            if table is not None:
                extra["table_xml_path"] = paths[table]
            text = " | ".join(cell["text"] for cell in extra["cells"])
        elif kind == "graphic":
            filenames = list(
                dict.fromkeys(c.attrib["gfname"] for c in element.iter() if "gfname" in c.attrib)
            )
            captions = [
                cap
                for c in element.iter()
                if _tag_name(c) == "GraphicCaption" and (cap := _text_of(c))
            ]
            parts_text = []
            if filenames:
                parts_text.append("図ファイル: " + ", ".join(filenames))
            parts_text.extend("図の説明: " + cap for cap in captions)
            text = "\n".join(parts_text)

        if not text and kind != "graphic":
            return

        refs: list[dict[str, Any]] = []
        seen_refs: set[tuple[str, str | None]] = set()
        for child in element.iter():
            tag = _tag_name(child)
            if tag not in _REFERENCE_TAGS:
                continue
            target_id = child.attrib.get("ref")
            key = (tag, target_id)
            if key in seen_refs:
                continue
            seen_refs.add(key)
            target_el = id_elements.get(target_id) if target_id else None
            target_sec = (
                _nearest_section(target_el, parents, section_by_element)
                if target_el is not None
                else None
            )
            refs.append(
                {
                    "kind": tag,
                    "target_xml_id": target_id,
                    "target_section_code": target_sec["code"] if target_sec else None,
                    "target_url": f"{pmda_url}#{target_id}" if target_id else None,
                }
            )

        scope = _context_labels(element, parents)
        scoped = _scoped_products(
            element,
            [] if kind == "table_row" else [element],
            parents,
            products,
            products_by_id,
            scope,
        )
        unit_yj_codes = [str(p["yj_code"]) for p in scoped if p.get("yj_code")]
        fragments.append(
            {
                "product_yj_codes": unit_yj_codes,
                "kind": kind,
                "section": {"code": section["code"], "title": section["title"]},
                "text": text,
                "context_labels": scope,
                "references": refs,
                **extra,
            }
        )

    def visit(element: ET.Element) -> None:
        name = _tag_name(element)
        if name in {"Category", "Frequency"} and element.attrib.get("id") in referenced_labels:
            return
        if name in _ATOMIC_UNITS:
            emit(element, _ATOMIC_UNITS[name])
            return
        if name in {"Detail", "Header", "Lang"}:
            emit(element, name.lower())
            return
        for child in element:
            visit(child)

    for child in root:
        if _tag_name(child) not in _HEADER_TAGS:
            visit(child)

    grouped: dict[tuple[str, tuple[str, ...]], list[dict[str, Any]]] = {}
    section_scope_counts: Counter[str] = Counter()
    for fragment in fragments:
        scope_codes = tuple(dict.fromkeys(str(c) for c in fragment["product_yj_codes"]))
        key = (str(fragment["section"]["code"]), scope_codes)
        if key not in grouped:
            section_scope_counts[key[0]] += 1
        grouped.setdefault(key, []).append(fragment)

    section_defs = {str(s["code"]): s for s in sections}
    primary_revision = next(
        (r for r in revisions if r.get("source_label") == "今回"),
        revisions[0],
    )
    revised_at = max(
        str(r["year_month"])
        for r in revisions
        if r.get("year_month") and _YEAR_MONTH_RE.match(str(r["year_month"]))
    )

    product_name_map = {
        str(p["yj_code"]): str(p["brand_name"])
        for p in products
        if p.get("yj_code") and p.get("brand_name")
    }

    search_units: list[ParsedSearchUnit] = []
    seen_section_scopes: Counter[str] = Counter()
    for position, ((sec_code, _scope_codes), parts) in enumerate(grouped.items()):
        seen_section_scopes[sec_code] += 1
        unit_id = (
            f"{pmda_key}:{sec_code}"
            if section_scope_counts[sec_code] == 1
            else f"{pmda_key}:{sec_code}:{seen_section_scopes[sec_code]}"
        )
        unit_codes = tuple(
            dict.fromkeys(code for part in parts for code in part["product_yj_codes"])
        )
        unit_product_names = list(
            dict.fromkeys(product_name_map[c] for c in unit_codes if c in product_name_map)
        )
        product_name = " / ".join(unit_product_names) or generic_name or pmda_key
        rendered_text = _render_section_text(parts, products)
        dedup_refs: list[dict[str, Any]] = []
        for part in parts:
            for ref in part["references"]:
                compact = {k: ref[k] for k in ("kind", "target_section_code", "target_url")}
                if compact not in dedup_refs:
                    dedup_refs.append(compact)

        sec_info = parts[0]["section"]
        searchable_text = " ".join(
            [
                sec_info["code"],
                sec_info["title"],
                product_name,
                generic_name,
                " ".join(unit_codes),
                rendered_text,
            ]
        )
        search_units.append(
            ParsedSearchUnit(
                unit_id=unit_id,
                position=position,
                section_code=sec_info["code"],
                section_title=sec_info["title"],
                kind="section",
                product_name=product_name,
                generic_name=generic_name,
                product_yj_codes=unit_codes,
                document_revision={k: v for k, v in primary_revision.items() if v is not None},
                text=rendered_text,
                query_text=normalize_search_text(searchable_text),
                columns=None,
                references=tuple(dedup_refs),
                url=str(section_defs[sec_code]["url"]),
            )
        )

    source_sha256 = hashlib.sha256(source).hexdigest()
    all_yj_codes = tuple(
        dict.fromkeys(
            str(p["yj_code"])
            for p in products
            if p.get("yj_code") and _YJ_CODE_RE.match(str(p["yj_code"]))
        )
    )
    return ParsedPackageInsert(
        document_id=pmda_key,
        source_sha256=source_sha256,
        filename=filename or "source.xml",
        revised_at=revised_at,
        generic_name=generic_name,
        pmda_url=pmda_url,
        section_count=len(sections),
        products=tuple(
            ImportedProductResponse(yj_code=p["yj_code"], brand_name=p["brand_name"])
            for p in products
        ),
        revisions=tuple(
            ImportedRevisionResponse(
                source_label=r["source_label"],
                year_month=r["year_month"],
                version=r["version"],
            )
            for r in revisions
        ),
        warnings=tuple(warnings),
        yj_codes=all_yj_codes,
        search_units=tuple(search_units),
    )
