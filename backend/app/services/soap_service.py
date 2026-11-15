from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.clients.soap_llm_client import SoapLlmClientError, SoapLlmClientProtocol
from app.schemas.soap import (
    LlmExtractSpoaResult,
    LlmFinalizeAResult,
    PlanItemRefModel,
    SoapEvidenceModel,
    SoapItemModel,
    SoapNoteModel,
    SoapSectionKey,
    TranscriptSegmentModel,
)


@dataclass(frozen=True)
class SoapApplyOutcome:
    """SOAP 差分の検証・適用結果。"""

    soap: SoapNoteModel
    changed_item_ids: list[str]
    retracted_item_ids: list[str]
    applied_operations: int
    rejected_operations: int
    stale_discarded: bool = False


class SoapStateManager:
    """1会話につき1件の SOAP ノートを保持し、根拠・役割制約・版整合を検証して原子更新する。"""

    def __init__(self, *, conversation_id: str, soap_id: str | None = None) -> None:
        self._note = SoapNoteModel(
            soap_id=soap_id or f"soap-{conversation_id}",
            conversation_id=conversation_id,
        )
        self._next_item_seq: dict[SoapSectionKey, int] = {"S": 1, "O": 1, "A": 1, "P": 1}

    @property
    def note(self) -> SoapNoteModel:
        return self._note.model_copy(deep=True)

    @property
    def has_plan_items(self) -> bool:
        return len(self._note.sections.P.items) > 0

    def has_stale_plan_inference(self) -> bool:
        return any(item.stale_after_plan_update for item in self._note.sections.A.items)

    def mark_transcript_processed(self, processed_transcript_revision: int) -> None:
        """LLM 呼び出し不要な発話（相槌等）のみだった場合に処理済み版だけ進める。"""
        self._note.processed_transcript_revision = max(
            self._note.processed_transcript_revision,
            processed_transcript_revision,
        )

    def build_extract_payload(
        self,
        *,
        new_segments: list[TranscriptSegmentModel],
        all_final_segments: list[TranscriptSegmentModel],
        max_context_segments: int = 6,
    ) -> dict[str, Any]:
        """会話中 extract_spoa 用の入力辞書を構築する（根拠発話と直近文脈も含める）。"""
        referenced_keys: set[tuple[str, str]] = set()
        for section in (
            self._note.sections.S,
            self._note.sections.O,
            self._note.sections.A,
            self._note.sections.P,
        ):
            for item in section.items:
                for ev in item.evidence:
                    referenced_keys.add((ev.stream_id, ev.segment_id))

        new_keys = {(seg.stream_id, seg.segment_id) for seg in new_segments}
        supporting_segments = [
            seg.model_dump(mode="json")
            for seg in all_final_segments
            if (seg.stream_id, seg.segment_id) in referenced_keys
            and (seg.stream_id, seg.segment_id) not in new_keys
        ]
        recent_context = [
            seg.model_dump(mode="json")
            for seg in all_final_segments
            if (seg.stream_id, seg.segment_id) not in referenced_keys
            and (seg.stream_id, seg.segment_id) not in new_keys
        ]
        if max_context_segments > 0 and len(recent_context) > max_context_segments:
            recent_context = recent_context[-max_context_segments:]
        elif max_context_segments <= 0:
            recent_context = []

        return {
            "conversation_id": self._note.conversation_id,
            "base_soap_revision": self._note.revision,
            "processed_transcript_revision": self._note.processed_transcript_revision,
            "current_soap": self._note.model_dump(mode="json"),
            "supporting_segments": supporting_segments,
            "recent_context_segments": recent_context,
            "new_segments": [seg.model_dump(mode="json") for seg in new_segments],
        }

    def build_finalize_a_payload(self) -> dict[str, Any]:
        """停止時 finalize_a_from_p 用の入力辞書を構築する（S/O 情報も参照用に渡す）。"""
        return {
            "conversation_id": self._note.conversation_id,
            "base_soap_revision": self._note.revision,
            "plan_revision": self._note.sections.P.revision,
            "s_items": [item.model_dump(mode="json") for item in self._note.sections.S.items],
            "o_items": [item.model_dump(mode="json") for item in self._note.sections.O.items],
            "plan_items": [item.model_dump(mode="json") for item in self._note.sections.P.items],
            "existing_a_items": [
                item.model_dump(mode="json") for item in self._note.sections.A.items
            ],
        }

    async def run_extract_spoa(
        self,
        *,
        llm_client: SoapLlmClientProtocol,
        new_segments: list[TranscriptSegmentModel],
        segments_snapshot_lookup: dict[tuple[str, str], TranscriptSegmentModel],
        current_segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
        target_processed_transcript_revision: int,
    ) -> SoapApplyOutcome:
        """extract_spoa を呼び出し、根拠の有効性を検証してから原子適用する。"""
        payload = self.build_extract_payload(
            new_segments=new_segments,
            all_final_segments=list(segments_snapshot_lookup.values()),
        )
        raw_result = await llm_client.extract_spoa(payload)
        return self.apply_extract_spoa_raw(
            raw_result=raw_result,
            segments_lookup=current_segments_lookup,
            processed_transcript_revision=target_processed_transcript_revision,
        )

    async def run_finalize_a_from_p(
        self,
        *,
        llm_client: SoapLlmClientProtocol,
        current_segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
    ) -> SoapApplyOutcome:
        """最新の P が存在する場合のみ finalize_a_from_p を実行し、A の推測案を更新する。"""
        if not self._note.sections.P.items:
            return SoapApplyOutcome(
                soap=self.note,
                changed_item_ids=[],
                retracted_item_ids=[],
                applied_operations=0,
                rejected_operations=0,
            )

        base_plan_items = {item.item_id: item.item_revision for item in self._note.sections.P.items}
        payload = self.build_finalize_a_payload()
        raw_result = await llm_client.finalize_a_from_p(payload)
        return self.apply_finalize_a_raw(
            raw_result=raw_result,
            segments_lookup=current_segments_lookup,
            expected_plan_items=base_plan_items,
        )

    def apply_extract_spoa_raw(
        self,
        *,
        raw_result: dict[str, Any],
        segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
        processed_transcript_revision: int,
    ) -> SoapApplyOutcome:
        """構造化出力を検証し、正当な差分だけを 1 回の SOAP 更新として適用する。"""
        try:
            parsed = LlmExtractSpoaResult.model_validate(raw_result)
        except ValidationError as exc:
            raise SoapLlmClientError(
                "SOAP 生成モデルの出力スキーマが不正です。",
                code="LLM_INVALID_OUTPUT",
            ) from exc

        # 不正な引用を含むバッチは、要素や処理済み版を変更する前に全体を拒否する
        for op in parsed.operations:
            if op.evidence_refs and not self._resolve_evidence(op.evidence_refs, segments_lookup):
                raise SoapLlmClientError(
                    "SOAP の根拠が確定発話の本文または最新版と一致しません。",
                    code="LLM_INVALID_OUTPUT",
                )

        working = self._note.model_copy(deep=True)
        changed_ids: list[str] = []
        retracted_ids: list[str] = []
        applied = 0
        rejected = 0
        dirty_sections: set[SoapSectionKey] = set()

        for op in parsed.operations:
            resolved_evidence = self._resolve_evidence(op.evidence_refs, segments_lookup)
            if not resolved_evidence:
                rejected += 1
                continue

            if op.action == "add":
                if op.target_section is not None and op.target_section != op.section:
                    rejected += 1
                    continue
                clean_text = (op.text or "").strip()
                if not clean_text or not self._is_section_evidence_allowed(
                    op.section, resolved_evidence
                ):
                    rejected += 1
                    continue

                dest_section = self._section_of(working, op.section)
                if op.section in {"S", "P"} and dest_section.items:
                    # S/P は1会話1項目を維持するため、既存項目がある場合は防御的に統合更新へ丸める
                    existing = dest_section.items[0]
                    merged_text = self._merge_consolidated_text(existing.text, clean_text)
                    dest_section.items[0] = self._build_updated_item(
                        existing=existing,
                        section=op.section,
                        text=merged_text,
                        requested_verification=op.verification_status,
                        resolved_evidence=resolved_evidence,
                        segments_lookup=segments_lookup,
                    )
                    dirty_sections.add(op.section)
                    changed_ids.append(existing.item_id)
                    applied += 1
                    continue

                item_id = self._mint_item_id(op.section)
                verification = self._resolve_verification_status(
                    op.section, op.verification_status, resolved_evidence
                )
                item = SoapItemModel(
                    item_id=item_id,
                    item_revision=1,
                    text=clean_text,
                    evidence=resolved_evidence,
                    origin="conversation",
                    verification_status=verification,
                )
                dest_section.items.append(item)
                dirty_sections.add(op.section)
                changed_ids.append(item_id)
                applied += 1
                continue

            if op.action == "update":
                if not op.item_id:
                    rejected += 1
                    continue
                src_section = self._section_of(working, op.section)
                existing_idx = self._find_item_index(src_section.items, op.item_id)
                if existing_idx is None:
                    rejected += 1
                    continue

                existing = src_section.items[existing_idx]
                dest_key = op.target_section or op.section
                if not self._is_section_evidence_allowed(dest_key, resolved_evidence) or (
                    dest_key != op.section
                    and not self._is_section_evidence_allowed(op.section, resolved_evidence)
                ):
                    rejected += 1
                    continue

                next_text = (op.text or "").strip() or existing.text
                verification = self._resolve_verification_status(
                    dest_key, op.verification_status, resolved_evidence
                )
                if dest_key != op.section:
                    # 欄移動は旧欄からの撤回と新欄への追加を同一更新内で原子的に行う
                    src_section.items.pop(existing_idx)
                    retracted_ids.append(existing.item_id)
                    new_item_id = self._mint_item_id(dest_key)
                    moved = SoapItemModel(
                        item_id=new_item_id,
                        item_revision=1,
                        text=next_text,
                        evidence=resolved_evidence,
                        origin="conversation",
                        verification_status=verification,
                    )
                    self._section_of(working, dest_key).items.append(moved)
                    dirty_sections.add(op.section)
                    dirty_sections.add(dest_key)
                    changed_ids.append(new_item_id)
                else:
                    src_section.items[existing_idx] = self._build_updated_item(
                        existing=existing,
                        section=op.section,
                        text=next_text,
                        requested_verification=op.verification_status,
                        resolved_evidence=resolved_evidence,
                        segments_lookup=segments_lookup,
                    )
                    dirty_sections.add(op.section)
                    changed_ids.append(existing.item_id)
                applied += 1
                continue

            if op.action == "retract":
                if (
                    not op.item_id
                    or not (op.retraction_reason or "").strip()
                    or not self._is_section_evidence_allowed(op.section, resolved_evidence)
                ):
                    rejected += 1
                    continue
                src_section = self._section_of(working, op.section)
                existing_idx = self._find_item_index(src_section.items, op.item_id)
                if existing_idx is None:
                    rejected += 1
                    continue
                src_section.items.pop(existing_idx)
                dirty_sections.add(op.section)
                retracted_ids.append(op.item_id)
                applied += 1

        if dirty_sections & {"S", "O", "P"}:
            for idx, a_item in enumerate(working.sections.A.items):
                if a_item.origin == "plan_inference" and not a_item.stale_after_plan_update:
                    working.sections.A.items[idx] = a_item.model_copy(
                        update={"stale_after_plan_update": True}
                    )
                    dirty_sections.add("A")

        for sec_key in dirty_sections:
            sec = self._section_of(working, sec_key)
            sec.revision += 1

        working.processed_transcript_revision = max(
            working.processed_transcript_revision,
            processed_transcript_revision,
        )
        if applied > 0 or dirty_sections:
            working.revision += 1

        self._note = working
        return SoapApplyOutcome(
            soap=self.note,
            changed_item_ids=changed_ids,
            retracted_item_ids=retracted_ids,
            applied_operations=applied,
            rejected_operations=rejected,
        )

    def apply_finalize_a_raw(
        self,
        *,
        raw_result: dict[str, Any],
        segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
        expected_plan_items: dict[str, int] | None = None,
    ) -> SoapApplyOutcome:
        """停止時の finalize_a_from_p 結果を検証・適用する（会話由来AとS/O/Pは一切変更しない）。"""
        try:
            parsed = LlmFinalizeAResult.model_validate(raw_result)
        except ValidationError as exc:
            raise SoapLlmClientError(
                "A 最終更新モデルの出力スキーマが不正です。",
                code="LLM_INVALID_OUTPUT",
            ) from exc

        current_plan_map = {item.item_id: item for item in self._note.sections.P.items}
        if not current_plan_map:
            return SoapApplyOutcome(
                soap=self.note,
                changed_item_ids=[],
                retracted_item_ids=[],
                applied_operations=0,
                rejected_operations=len(parsed.operations),
            )

        if expected_plan_items is not None:
            current_revs = {
                item_id: item.item_revision for item_id, item in current_plan_map.items()
            }
            if current_revs != expected_plan_items:
                return SoapApplyOutcome(
                    soap=self.note,
                    changed_item_ids=[],
                    retracted_item_ids=[],
                    applied_operations=0,
                    rejected_operations=len(parsed.operations),
                    stale_discarded=True,
                )

        working = self._note.model_copy(deep=True)
        changed_ids: list[str] = []
        retracted_ids: list[str] = []
        applied = 0
        rejected = 0

        for op in parsed.operations:
            plan_refs: list[PlanItemRefModel] = []
            refs_valid = True
            for ref in op.derived_from_plan_items:
                current_plan_item = current_plan_map.get(ref.item_id)
                if (
                    current_plan_item is None
                    or current_plan_item.item_revision != ref.item_revision
                ):
                    refs_valid = False
                    break
                plan_refs.append(
                    PlanItemRefModel(item_id=ref.item_id, item_revision=ref.item_revision)
                )

            if op.action in {"add", "update"} and (not refs_valid or not plan_refs):
                rejected += 1
                continue

            resolved_evidence = self._resolve_evidence(op.evidence_refs, segments_lookup)
            if op.evidence_refs and not resolved_evidence:
                rejected += 1
                continue
            if not op.evidence_refs and plan_refs:
                # 根拠発話が省略された場合は、検証済み P 要素が持つ根拠をそのまま継承する
                inherited: list[SoapEvidenceModel] = []
                for plan_ref in plan_refs:
                    p_item = current_plan_map[plan_ref.item_id]
                    for ev in p_item.evidence:
                        inherited.append(ev.model_copy(deep=True))
                resolved_evidence = self._resolve_evidence(inherited, segments_lookup)

            if not resolved_evidence:
                rejected += 1
                continue

            if op.action == "add":
                clean_text = (op.text or "").strip()
                if not clean_text:
                    rejected += 1
                    continue
                item_id = self._mint_item_id("A")
                working.sections.A.items.append(
                    SoapItemModel(
                        item_id=item_id,
                        item_revision=1,
                        text=clean_text,
                        evidence=resolved_evidence,
                        origin="plan_inference",
                        derived_from_plan_items=plan_refs,
                        stale_after_plan_update=False,
                        verification_status="draft_inference",
                    )
                )
                changed_ids.append(item_id)
                applied += 1
                continue

            if op.action == "update":
                if not op.item_id:
                    rejected += 1
                    continue
                idx = self._find_item_index(working.sections.A.items, op.item_id)
                if idx is None or working.sections.A.items[idx].origin != "plan_inference":
                    # 会話由来 A を推測で上書きしない
                    rejected += 1
                    continue
                existing = working.sections.A.items[idx]
                next_text = (op.text or "").strip() or existing.text
                working.sections.A.items[idx] = SoapItemModel(
                    item_id=existing.item_id,
                    item_revision=existing.item_revision + 1,
                    text=next_text,
                    evidence=resolved_evidence,
                    origin="plan_inference",
                    derived_from_plan_items=plan_refs,
                    stale_after_plan_update=False,
                    verification_status="draft_inference",
                )
                changed_ids.append(existing.item_id)
                applied += 1
                continue

            if op.action == "retract":
                if not op.item_id or not (op.retraction_reason or "").strip():
                    rejected += 1
                    continue
                idx = self._find_item_index(working.sections.A.items, op.item_id)
                if idx is None or working.sections.A.items[idx].origin != "plan_inference":
                    rejected += 1
                    continue
                working.sections.A.items.pop(idx)
                retracted_ids.append(op.item_id)
                applied += 1

        if applied > 0:
            working.sections.A.revision += 1
            working.sections.A.derived_from_plan_revision = working.sections.P.revision
            working.revision += 1
            self._note = working

        return SoapApplyOutcome(
            soap=self.note,
            changed_item_ids=changed_ids,
            retracted_item_ids=retracted_ids,
            applied_operations=applied,
            rejected_operations=rejected,
        )

    def _mint_item_id(self, section: SoapSectionKey) -> str:
        seq = self._next_item_seq[section]
        self._next_item_seq[section] = seq + 1
        return f"soap-{section}-{seq}"

    @staticmethod
    def _section_of(note: SoapNoteModel, key: SoapSectionKey) -> Any:
        return getattr(note.sections, key)

    @staticmethod
    def _find_item_index(items: list[SoapItemModel], item_id: str) -> int | None:
        for idx, item in enumerate(items):
            if item.item_id == item_id:
                return idx
        return None

    @staticmethod
    def _resolve_evidence(
        refs: list[Any],
        segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
    ) -> list[SoapEvidenceModel]:
        resolved: list[SoapEvidenceModel] = []
        for ref in refs:
            seg = segments_lookup.get((ref.stream_id, ref.segment_id))
            if (
                seg is None
                or seg.status == "interim"
                or seg.segment_revision != ref.segment_revision
            ):
                return []
            quote = ref.quote.strip()
            if not SoapStateManager._quote_matches(quote, seg.text):
                return []
            resolved.append(
                SoapEvidenceModel(
                    stream_id=seg.stream_id,
                    segment_id=seg.segment_id,
                    segment_revision=seg.segment_revision,
                    quote=quote,
                    speaker_role=seg.speaker_role,
                )
            )
        return resolved

    @staticmethod
    def _quote_matches(quote: str, text: str) -> bool:
        """空白・改行のみを正規化し、引用が発話本文の一部であることを確認する。"""
        normalized_quote = "".join(quote.split())
        return bool(normalized_quote) and normalized_quote in "".join(text.split())

    @staticmethod
    def _merge_consolidated_text(existing_text: str, addition_text: str) -> str:
        """既存文と新規文が重複しない場合に句点区切りで結合する。"""
        base = existing_text.strip()
        addition = addition_text.strip()
        if not base:
            return addition
        if not addition or addition in base:
            return base
        if base in addition:
            return addition
        if base[-1] in ("。", "！", "!", "？", "?", "."):
            return f"{base}{addition}"
        return f"{base}。{addition}"

    @classmethod
    def _build_updated_item(
        cls,
        *,
        existing: SoapItemModel,
        section: SoapSectionKey,
        text: str,
        requested_verification: str,
        resolved_evidence: list[SoapEvidenceModel],
        segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
    ) -> SoapItemModel:
        """既存要素の逐次更新モデルを構築し、S/P では既存有効根拠も保持する。"""
        merged_evidence = (
            cls._merge_section_evidence(existing.evidence, resolved_evidence, segments_lookup)
            if section in {"S", "P"}
            else resolved_evidence
        )
        verification = cls._resolve_verification_status(
            section, requested_verification, resolved_evidence
        )
        return SoapItemModel(
            item_id=existing.item_id,
            item_revision=existing.item_revision + 1,
            text=text,
            evidence=merged_evidence,
            origin="conversation",
            verification_status=verification,
        )

    @staticmethod
    def _merge_section_evidence(
        existing_evidence: list[SoapEvidenceModel],
        resolved_evidence: list[SoapEvidenceModel],
        segments_lookup: dict[tuple[str, str], TranscriptSegmentModel],
    ) -> list[SoapEvidenceModel]:
        """S / P の逐次更新時に、有効な既存根拠を失わずに新規根拠を統合する。"""
        merged: dict[tuple[str, str], SoapEvidenceModel] = {}
        order: list[tuple[str, str]] = []
        for ev in existing_evidence:
            key = (ev.stream_id, ev.segment_id)
            seg = segments_lookup.get(key)
            if (
                seg is None
                or seg.status == "interim"
                or not SoapStateManager._quote_matches(ev.quote, seg.text)
            ):
                continue
            merged[key] = SoapEvidenceModel(
                stream_id=seg.stream_id,
                segment_id=seg.segment_id,
                segment_revision=seg.segment_revision,
                quote=ev.quote,
                speaker_role=seg.speaker_role,
            )
            order.append(key)
        for ev in resolved_evidence:
            key = (ev.stream_id, ev.segment_id)
            if key not in merged:
                order.append(key)
            merged[key] = ev
        return [merged[key] for key in order]

    @staticmethod
    def _is_section_evidence_allowed(
        section: SoapSectionKey,
        evidence: list[SoapEvidenceModel],
    ) -> bool:
        if section == "S":
            return any(ev.speaker_role == "patient" for ev in evidence)
        if section in {"P", "A"}:
            return any(ev.speaker_role == "pharmacist" for ev in evidence)
        return any(ev.speaker_role in {"pharmacist", "patient"} for ev in evidence)

    @staticmethod
    def _resolve_verification_status(
        section: SoapSectionKey,
        requested: str,
        evidence: list[SoapEvidenceModel],
    ) -> Any:
        if section == "O":
            if requested == "confirmed" and any(ev.speaker_role == "pharmacist" for ev in evidence):
                return "confirmed"
            return "reported"
        return "reported"
