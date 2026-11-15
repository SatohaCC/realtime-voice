import re
from typing import Any

from app.clients.soap_llm_client import is_ignorable_utterance_text, serialize_untrusted_payload
from app.core.config import settings

_OBJECTIVE_METRIC_RE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:℃|度|mmHg|mg|g|ml|mL|%|回|日分|錠|カプセル)|血圧|体温|HbA1c|eGFR|検査値|脈拍|SpO2|体重|処方)",
    re.IGNORECASE,
)
_ASSESSMENT_HINT_RE = re.compile(
    r"(評価|判断|考えられ|可能性があ|改善傾向|悪化|良好|安定|副作用|アドヒアランス|要注意|問題なさそう|継続可能)",
)
_CORRECTION_HINT_RE = re.compile(r"(訂正|間違い|ではなく|撤回|取り消)")
_QUESTION_END_RE = re.compile(r"[？?]\s*$")
_PLAN_VERB_RE = re.compile(
    r"(してください|てください|飲んで|飲ま|避け|しましょう|続け|服用|注意|控え|受診|様子を見|確認します|説明します|指導|変更|追加|中止|再開|減量|増量)",
)


def _normalize_summary_text(text: str, *, max_len: int = 120) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    if len(collapsed) <= max_len:
        return collapsed
    return f"{collapsed[: max_len - 1]}…"


def _ensure_terminal_punctuation(text: str) -> str:
    if not text:
        return ""
    if text[-1] in ("。", "！", "!", "？", "?", "."):
        return text
    return f"{text}。"


def _merge_plan_text(existing: str, addition: str, *, max_len: int = 500) -> str:
    clean_add = re.sub(r"\s+", " ", addition).strip()
    if not clean_add:
        return existing
    clean_base = re.sub(r"\s+", " ", existing).strip()
    if not clean_base:
        return _normalize_summary_text(clean_add, max_len=max_len)
    if clean_add in clean_base:
        return clean_base
    joined = f"{_ensure_terminal_punctuation(clean_base)}{clean_add}"
    return _normalize_summary_text(joined, max_len=max_len)


def _drop_last_sentence(text: str) -> str:
    sentences = [
        part.strip() for part in re.split(r"(?<=[。！？!?])\s*", text.strip()) if part.strip()
    ]
    if len(sentences) <= 1:
        return ""
    return "".join(sentences[:-1])


def _append_evidence_ref(
    refs: list[dict[str, Any]],
    candidate: dict[str, Any],
) -> None:
    key = (candidate["stream_id"], candidate["segment_id"])
    for idx, existing in enumerate(refs):
        if (existing["stream_id"], existing["segment_id"]) == key:
            refs[idx] = candidate
            return
    refs.append(candidate)


def _extract_non_plan_operations_for_segment(
    segment: dict[str, Any],
    existing_items: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], bool]:
    """テスト用 Fake クライアント向けに S/O/A 操作候補と P 該当可否を抽出する。"""
    text = str(segment.get("text", "")).strip()
    if is_ignorable_utterance_text(text):
        return [], False

    role = segment.get("speaker_role")
    seg_ref = {
        "stream_id": str(segment.get("stream_id", "")),
        "segment_id": str(segment.get("segment_id", "")),
        "segment_revision": int(segment.get("segment_revision", 1)),
        "quote": text[:80],
    }

    is_question = bool(_QUESTION_END_RE.search(text))
    ops: list[dict[str, Any]] = []
    has_correction = bool(_CORRECTION_HINT_RE.search(text))

    if has_correction and role == "patient":
        existing_s = existing_items.get("S", [])
        if existing_s:
            latest = existing_s[-1]
            ops.append(
                {
                    "action": "retract",
                    "section": "S",
                    "item_id": latest["item_id"],
                    "evidence_refs": [seg_ref],
                    "retraction_reason": "会話内の訂正・取消発言に基づく撤回",
                }
            )

    if _OBJECTIVE_METRIC_RE.search(text) and not is_question:
        ops.append(
            {
                "action": "add",
                "section": "O",
                "text": _normalize_summary_text(text),
                "evidence_refs": [seg_ref],
                "verification_status": "confirmed" if role == "pharmacist" else "reported",
            }
        )

    if role == "patient":
        if not _OBJECTIVE_METRIC_RE.search(text):
            ops.append(
                {
                    "action": "add",
                    "section": "S",
                    "text": _normalize_summary_text(text),
                    "evidence_refs": [seg_ref],
                    "verification_status": "reported",
                }
            )
        return ops, False

    if role == "pharmacist":
        if is_question:
            return ops, False
        has_assessment = bool(_ASSESSMENT_HINT_RE.search(text))
        if has_assessment:
            ops.append(
                {
                    "action": "add",
                    "section": "A",
                    "text": _normalize_summary_text(text),
                    "evidence_refs": [seg_ref],
                    "verification_status": "reported",
                }
            )
        should_update_plan = bool(_PLAN_VERB_RE.search(text)) or (
            not has_assessment and not has_correction and not ops
        )
        return ops, should_update_plan
    return ops, False


class FakeSoapLlmClient:
    """オフライン自動テスト専用の決定的なスタブ LLM クライアント。"""

    def __init__(self, *, max_input_chars: int | None = None) -> None:
        self._max_input_chars = (
            max_input_chars if max_input_chars is not None else settings.soap_llm_max_input_chars
        )

    async def extract_soap(self, payload: dict[str, Any]) -> dict[str, Any]:
        serialize_untrusted_payload(payload, max_chars=self._max_input_chars)
        new_segments = payload.get("new_segments", [])
        current_soap = payload.get("current_soap", {})
        sections = current_soap.get("sections", {})
        existing_items: dict[str, list[dict[str, Any]]] = {
            key: list(sections.get(key, {}).get("items", [])) for key in ("S", "O", "A", "P")
        }

        existing_p = existing_items["P"][0] if existing_items["P"] else None
        active_plan_id: str | None = str(existing_p["item_id"]) if existing_p else None
        plan_text = str(existing_p.get("text", "")).strip() if existing_p else ""
        plan_evidence_refs: list[dict[str, Any]] = []
        if existing_p:
            for ev in existing_p.get("evidence", []):
                if isinstance(ev, dict) and ev.get("segment_id"):
                    _append_evidence_ref(
                        plan_evidence_refs,
                        {
                            "stream_id": str(ev["stream_id"]),
                            "segment_id": str(ev["segment_id"]),
                            "segment_revision": int(ev["segment_revision"]),
                            "quote": str(ev["quote"]),
                        },
                    )
        plan_modified = False
        plan_retracted = False
        plan_retract_ref: dict[str, Any] | None = None

        operations: list[dict[str, Any]] = []
        for segment in new_segments:
            if not isinstance(segment, dict):
                continue
            seg_ops, should_update_plan = _extract_non_plan_operations_for_segment(
                segment, existing_items
            )
            operations.extend(seg_ops)

            text = str(segment.get("text", "")).strip()
            if is_ignorable_utterance_text(text):
                continue
            role = segment.get("speaker_role")
            if role != "pharmacist" or _QUESTION_END_RE.search(text):
                continue

            seg_ref = {
                "stream_id": str(segment.get("stream_id", "")),
                "segment_id": str(segment.get("segment_id", "")),
                "segment_revision": int(segment.get("segment_revision", 1)),
                "quote": text[:80],
            }

            if _CORRECTION_HINT_RE.search(text) and plan_text:
                trimmed = _drop_last_sentence(plan_text)
                plan_text = trimmed
                plan_modified = True
                if trimmed:
                    _append_evidence_ref(plan_evidence_refs, seg_ref)
                else:
                    plan_retracted = True
                    plan_retract_ref = seg_ref
                    if active_plan_id is None:
                        plan_evidence_refs.clear()

            if should_update_plan:
                plan_text = _merge_plan_text(plan_text, text)
                _append_evidence_ref(plan_evidence_refs, seg_ref)
                plan_modified = True
                plan_retracted = False

        if active_plan_id is not None:
            if plan_retracted and not plan_text and plan_retract_ref is not None:
                operations.append(
                    {
                        "action": "retract",
                        "section": "P",
                        "item_id": active_plan_id,
                        "evidence_refs": [plan_retract_ref],
                        "retraction_reason": "会話内の訂正・取消発言に基づく撤回",
                    }
                )
            elif plan_modified and plan_text:
                operations.append(
                    {
                        "action": "update",
                        "section": "P",
                        "item_id": active_plan_id,
                        "text": plan_text,
                        "evidence_refs": plan_evidence_refs,
                        "verification_status": "reported",
                    }
                )
        elif plan_modified and plan_text:
            operations.append(
                {
                    "action": "add",
                    "section": "P",
                    "text": plan_text,
                    "evidence_refs": plan_evidence_refs,
                    "verification_status": "reported",
                }
            )
        return {"operations": operations}

    async def finalize_a_from_p(self, payload: dict[str, Any]) -> dict[str, Any]:
        serialize_untrusted_payload(payload, max_chars=self._max_input_chars)
        plan_items = list(payload.get("plan_items", []))
        existing_a_items = list(payload.get("existing_a_items", []))
        if not plan_items:
            return {"operations": []}

        plan_refs = [
            {
                "item_id": str(item["item_id"]),
                "item_revision": int(item["item_revision"]),
            }
            for item in plan_items
            if isinstance(item, dict) and item.get("item_id")
        ]
        if not plan_refs:
            return {"operations": []}

        evidence_refs: list[dict[str, Any]] = []
        for item in plan_items:
            for ev in item.get("evidence", []):
                if isinstance(ev, dict) and ev.get("segment_id"):
                    evidence_refs.append(
                        {
                            "stream_id": str(ev["stream_id"]),
                            "segment_id": str(ev["segment_id"]),
                            "segment_revision": int(ev["segment_revision"]),
                            "quote": str(ev["quote"]),
                        }
                    )
                    break
            if evidence_refs:
                break

        summary = " / ".join(
            _normalize_summary_text(str(item.get("text", "")), max_len=160)
            for item in plan_items[:3]
            if item.get("text")
        )
        draft_text = f"Pからの評価案（要確認）: {summary} について指導・経過フォロー方針を想定"
        existing_inference = next(
            (
                item
                for item in existing_a_items
                if isinstance(item, dict) and item.get("origin") == "plan_inference"
            ),
            None,
        )

        if existing_inference is not None:
            return {
                "operations": [
                    {
                        "action": "update",
                        "item_id": str(existing_inference["item_id"]),
                        "text": draft_text,
                        "derived_from_plan_items": plan_refs,
                        "evidence_refs": evidence_refs,
                    }
                ]
            }

        return {
            "operations": [
                {
                    "action": "add",
                    "text": draft_text,
                    "derived_from_plan_items": plan_refs,
                    "evidence_refs": evidence_refs,
                }
            ]
        }
