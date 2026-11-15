import asyncio
from typing import Any

import pytest

from app.clients.soap_llm_client import FakeSoapLlmClient, SoapLlmClientError
from app.schemas.soap import TranscriptSegmentModel
from app.services.conversation_service import ConversationTranscriptState, DeepgramTranscriptInput
from app.services.soap_service import SoapStateManager


def _evidence(seg: TranscriptSegmentModel, quote: str | None = None) -> dict[str, Any]:
    return {
        "stream_id": seg.stream_id,
        "segment_id": seg.segment_id,
        "segment_revision": seg.segment_revision,
        "quote": seg.text if quote is None else quote,
    }


@pytest.mark.parametrize("mixed", [False, True])
def test_invalid_quote_rejects_whole_batch_without_advancing_revision(mixed: bool) -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    refs = [_evidence(conv.segments[3], "毎食後に2錠服用してください。")]
    if mixed:
        refs.insert(0, _evidence(conv.segments[3]))
    with pytest.raises(SoapLlmClientError):
        manager.apply_extract_spoa_raw(
            raw_result={
                "operations": [
                    {
                        "action": "add",
                        "section": "P",
                        "text": "毎食後2錠",
                        "evidence_refs": refs,
                    }
                ]
            },
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision,
        )
    assert manager.note.revision == 0
    assert manager.note.processed_transcript_revision == 0
    assert manager.note.sections.P.items == []


def test_quote_accepts_substring_with_whitespace_differences() -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    outcome = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "P",
                    "text": "毎食後1錠",
                    "evidence_refs": [_evidence(conv.segments[3], "毎食後に 1錠\n服用")],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert outcome.applied_operations == 1


def test_final_a_does_not_replace_invalid_explicit_quote_with_inherited_evidence() -> None:
    async def _run() -> None:
        conv, lookup = _setup_conversation()
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        await manager.run_extract_spoa(
            llm_client=FakeSoapLlmClient(),
            new_segments=conv.finalized_segments,
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        plan = manager.note.sections.P.items[0]
        before = manager.note
        outcome = manager.apply_finalize_a_raw(
            raw_result={
                "operations": [
                    {
                        "action": "add",
                        "text": "未発言の根拠による推測",
                        "derived_from_plan_items": [{"item_id": plan.item_id, "item_revision": 1}],
                        "evidence_refs": [_evidence(conv.segments[3], "服用は不要です。")],
                    }
                ]
            },
            segments_lookup=lookup,
        )
        assert outcome.rejected_operations == 1
        assert manager.note == before

    asyncio.run(_run())


def test_plan_update_drops_old_quote_removed_by_transcript_refinement() -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    original = conv.segments[3]
    first = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "P",
                    "text": original.text,
                    "evidence_refs": [_evidence(original)],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    refined = original.model_copy(update={"text": "その指導を撤回します。", "segment_revision": 2})
    lookup[(refined.stream_id, refined.segment_id)] = refined
    outcome = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "update",
                    "section": "P",
                    "item_id": first.soap.sections.P.items[0].item_id,
                    "text": conv.segments[0].text,
                    "evidence_refs": [_evidence(conv.segments[0])],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert len(outcome.soap.sections.P.items[0].evidence) == 1
    assert outcome.soap.sections.P.items[0].evidence[0].segment_id == conv.segments[0].segment_id


@pytest.mark.parametrize("section,index,wrong_index", [("P", 3, 1), ("A", 2, 1), ("S", 1, 0)])
def test_retraction_requires_section_speaker_evidence(
    section: str,
    index: int,
    wrong_index: int,
) -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    first = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": section,
                    "text": conv.segments[index].text,
                    "evidence_refs": [_evidence(conv.segments[index])],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    item_id = getattr(first.soap.sections, section).items[0].item_id
    for evidence_index, expected in [(wrong_index, 0), (index, 1)]:
        outcome = manager.apply_extract_spoa_raw(
            raw_result={
                "operations": [
                    {
                        "action": "retract",
                        "section": section,
                        "item_id": item_id,
                        "retraction_reason": "発言の訂正",
                        "evidence_refs": [_evidence(conv.segments[evidence_index])],
                    }
                ]
            },
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision,
        )
        assert outcome.applied_operations == expected
        assert len(getattr(outcome.soap.sections, section).items) == 1 - expected


def _setup_conversation() -> tuple[ConversationTranscriptState, dict[tuple[str, str], Any]]:
    conv = ConversationTranscriptState(conversation_id="conv-soap-1")
    conv.start_stream("stream-1")
    conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="今日はどうされましたか？",
            is_final=True,
            speech_final=True,
            start_sec=0.1,
            end_sec=1.0,
            confidence=0.95,
        )
    )
    conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="昨日から喉が痛く、今朝の体温は37.8℃でした。",
            is_final=True,
            speech_final=True,
            start_sec=1.2,
            end_sec=3.0,
            confidence=0.96,
        )
    )
    conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="飲み込みづらさの訴えから咽頭炎の初期症状が考えられます。",
            is_final=True,
            speech_final=True,
            start_sec=3.2,
            end_sec=5.0,
            confidence=0.94,
        )
    )
    conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="処方薬は毎食後に1錠服用してください。",
            is_final=True,
            speech_final=True,
            start_sec=5.2,
            end_sec=7.0,
            confidence=0.96,
        )
    )
    lookup = {(seg.stream_id, seg.segment_id): seg for seg in conv.segments}
    return conv, lookup


def test_role_validation_blocks_patient_in_p_or_a_and_pharmacist_in_s() -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    patient_seg = conv.segments[1]
    pharmacist_seg = conv.segments[0]

    outcome = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "P",
                    "text": "患者発言を誤ってPへ入れた",
                    "evidence_refs": [
                        {
                            "stream_id": patient_seg.stream_id,
                            "segment_id": patient_seg.segment_id,
                            "segment_revision": patient_seg.segment_revision,
                            "quote": patient_seg.text,
                        }
                    ],
                },
                {
                    "action": "add",
                    "section": "S",
                    "text": "薬剤師の質問を誤ってSへ入れた",
                    "evidence_refs": [
                        {
                            "stream_id": pharmacist_seg.stream_id,
                            "segment_id": pharmacist_seg.segment_id,
                            "segment_revision": pharmacist_seg.segment_revision,
                            "quote": pharmacist_seg.text,
                        }
                    ],
                },
                {
                    "action": "add",
                    "section": "O",
                    "text": "体温 37.8℃",
                    "verification_status": "confirmed",
                    "evidence_refs": [
                        {
                            "stream_id": patient_seg.stream_id,
                            "segment_id": patient_seg.segment_id,
                            "segment_revision": patient_seg.segment_revision,
                            "quote": "今朝の体温は37.8℃",
                        }
                    ],
                },
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )

    assert outcome.applied_operations == 1
    assert outcome.rejected_operations == 2
    assert outcome.soap.sections.S.items == []
    assert outcome.soap.sections.P.items == []
    assert len(outcome.soap.sections.O.items) == 1
    # 患者自己申告の測定値は confirmed に昇格させない
    assert outcome.soap.sections.O.items[0].verification_status == "reported"


def test_atomic_update_section_move_and_retract_validation() -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    patient_seg = conv.segments[1]
    pharmacist_plan = conv.segments[3]

    first = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "S",
                    "text": "昨日から咽頭痛あり",
                    "evidence_refs": [
                        {
                            "stream_id": patient_seg.stream_id,
                            "segment_id": patient_seg.segment_id,
                            "segment_revision": patient_seg.segment_revision,
                            "quote": "昨日から喉が痛く",
                        }
                    ],
                },
                {
                    "action": "add",
                    "section": "P",
                    "text": "毎食後1錠を服用指導",
                    "evidence_refs": [
                        {
                            "stream_id": pharmacist_plan.stream_id,
                            "segment_id": pharmacist_plan.segment_id,
                            "segment_revision": pharmacist_plan.segment_revision,
                            "quote": pharmacist_plan.text,
                        }
                    ],
                },
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    s_id = first.soap.sections.S.items[0].item_id
    p_id = first.soap.sections.P.items[0].item_id

    # 空の出力だけでは既存要素が消えないこと、理由なし撤回は拒否されること
    unchanged = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "retract",
                    "section": "S",
                    "item_id": s_id,
                    "evidence_refs": [
                        {
                            "stream_id": patient_seg.stream_id,
                            "segment_id": patient_seg.segment_id,
                            "segment_revision": patient_seg.segment_revision,
                            "quote": "昨日から喉が痛く",
                        }
                    ],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert unchanged.rejected_operations == 1
    assert len(unchanged.soap.sections.S.items) == 1

    # 未知IDや無効スキーマに対する耐性
    with pytest.raises(SoapLlmClientError):
        manager.apply_extract_spoa_raw(
            raw_result={"operations": [{"action": "invalid"}]},
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision,
        )

    # S -> O への欄移動と P の更新が 1 つの revision で原子適用されること
    moved = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "update",
                    "section": "S",
                    "target_section": "O",
                    "item_id": s_id,
                    "text": "今朝の体温 37.8℃（自己測定）",
                    "evidence_refs": [
                        {
                            "stream_id": patient_seg.stream_id,
                            "segment_id": patient_seg.segment_id,
                            "segment_revision": patient_seg.segment_revision,
                            "quote": "今朝の体温は37.8℃",
                        }
                    ],
                },
                {
                    "action": "update",
                    "section": "P",
                    "item_id": p_id,
                    "text": "毎食後1錠を5日分服用指導",
                    "evidence_refs": [
                        {
                            "stream_id": pharmacist_plan.stream_id,
                            "segment_id": pharmacist_plan.segment_id,
                            "segment_revision": pharmacist_plan.segment_revision,
                            "quote": pharmacist_plan.text,
                        }
                    ],
                },
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert moved.applied_operations == 2
    assert moved.soap.sections.S.items == []
    assert len(moved.soap.sections.O.items) == 1
    assert moved.soap.sections.P.items[0].item_id == p_id
    assert moved.soap.sections.P.items[0].item_revision == 2


def test_fake_llm_flow_preserves_spoken_a_and_marks_stale_after_resume_p_update() -> None:
    async def _run() -> None:
        conv, lookup = _setup_conversation()
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        fake_llm = FakeSoapLlmClient()

        extract_outcome = await manager.run_extract_spoa(
            llm_client=fake_llm,
            new_segments=conv.finalized_segments,
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert len(extract_outcome.soap.sections.O.items) >= 1
        assert len(extract_outcome.soap.sections.A.items) >= 1
        assert len(extract_outcome.soap.sections.P.items) >= 1
        spoken_a_id = extract_outcome.soap.sections.A.items[0].item_id

        final_outcome = await manager.run_finalize_a_from_p(
            llm_client=fake_llm,
            current_segments_lookup=lookup,
        )
        assert len(final_outcome.soap.sections.A.items) == 2
        assert any(
            item.item_id == spoken_a_id and item.origin == "conversation"
            for item in final_outcome.soap.sections.A.items
        )
        inferred = [
            item for item in final_outcome.soap.sections.A.items if item.origin == "plan_inference"
        ]
        assert len(inferred) == 1
        assert (
            inferred[0].derived_from_plan_items[0].item_id
            == final_outcome.soap.sections.P.items[0].item_id
        )

        # 再開後に P が更新されると、P由来の推測は stale_after_plan_update=True になる
        conv.start_stream("stream-2")
        resumed = conv.apply_deepgram_event(
            DeepgramTranscriptInput(
                channel_index=0,
                text="症状が続く場合は3日後に再受診してください。",
                is_final=True,
                speech_final=True,
                start_sec=0.2,
                end_sec=2.0,
                confidence=0.95,
            )
        )
        assert resumed.segment is not None
        updated_lookup = {(seg.stream_id, seg.segment_id): seg for seg in conv.segments}
        resumed_outcome = await manager.run_extract_spoa(
            llm_client=fake_llm,
            new_segments=[resumed.segment],
            segments_snapshot_lookup=updated_lookup,
            current_segments_lookup=updated_lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        inferred_after_resume = [
            item
            for item in resumed_outcome.soap.sections.A.items
            if item.origin == "plan_inference"
        ]
        assert inferred_after_resume[0].stale_after_plan_update is True
        assert resumed_outcome.soap.sections.A.items[0].origin == "conversation"
        assert len(resumed_outcome.soap.sections.P.items) == 1
        assert resumed_outcome.soap.sections.P.items[0].item_revision == 2
        assert "毎食後に1錠服用してください。" in resumed_outcome.soap.sections.P.items[0].text
        assert "3日後に再受診してください。" in resumed_outcome.soap.sections.P.items[0].text
        assert len(resumed_outcome.soap.sections.P.items[0].evidence) == 2

    asyncio.run(_run())


def test_fake_llm_consolidates_batch_plan_utterances_and_updates_single_item() -> None:
    async def _run() -> None:
        conv = ConversationTranscriptState(conversation_id="conv-plan-merge")
        conv.start_stream("stream-1")
        conv.apply_deepgram_event(
            DeepgramTranscriptInput(
                channel_index=0,
                text="お薬は毎食後に1錠服用してください。",
                is_final=True,
                speech_final=True,
                start_sec=0.1,
                end_sec=1.5,
                confidence=0.95,
            )
        )
        conv.apply_deepgram_event(
            DeepgramTranscriptInput(
                channel_index=0,
                text="飲み忘れに気づいたら1回分だけ飲んでください。",
                is_final=True,
                speech_final=True,
                start_sec=1.8,
                end_sec=3.2,
                confidence=0.95,
            )
        )
        lookup = {(seg.stream_id, seg.segment_id): seg for seg in conv.segments}
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        fake_llm = FakeSoapLlmClient()

        first = await manager.run_extract_spoa(
            llm_client=fake_llm,
            new_segments=conv.finalized_segments,
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert len(first.soap.sections.P.items) == 1
        p_item = first.soap.sections.P.items[0]
        assert (
            p_item.text
            == "お薬は毎食後に1錠服用してください。飲み忘れに気づいたら1回分だけ飲んでください。"
        )
        assert len(p_item.evidence) == 2

        correction = conv.apply_deepgram_event(
            DeepgramTranscriptInput(
                channel_index=0,
                text="先ほどのは訂正して、発疹が出たらすぐ服用を中止してください。",
                is_final=True,
                speech_final=True,
                start_sec=3.5,
                end_sec=5.0,
                confidence=0.95,
            )
        )
        assert correction.segment is not None
        updated_lookup = {(seg.stream_id, seg.segment_id): seg for seg in conv.segments}
        second = await manager.run_extract_spoa(
            llm_client=fake_llm,
            new_segments=[correction.segment],
            segments_snapshot_lookup=updated_lookup,
            current_segments_lookup=updated_lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert len(second.soap.sections.P.items) == 1
        assert second.soap.sections.P.items[0].item_id == p_item.item_id
        assert second.soap.sections.P.items[0].item_revision == 2
        assert "飲み忘れに気づいたら" not in second.soap.sections.P.items[0].text
        assert "発疹が出たらすぐ服用を中止してください。" in second.soap.sections.P.items[0].text

    asyncio.run(_run())


def test_finalize_a_skips_when_plan_empty_and_discards_stale_concurrent_p_change() -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    pharm_a = conv.segments[2]
    pharm_p = conv.segments[3]

    # P が空の間は finalize_a_from_p で A に推測を追加しない
    empty_p = manager.apply_finalize_a_raw(
        raw_result={
            "operations": [{"action": "add", "text": "不要", "derived_from_plan_items": []}]
        },
        segments_lookup=lookup,
        expected_plan_items={},
    )
    assert empty_p.applied_operations == 0
    assert empty_p.soap.sections.A.items == []

    # A(会話由来) と P を追加後、expected_plan_items が食い違う古い推測結果を破棄する
    added = manager.apply_extract_spoa_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "A",
                    "text": "咽頭炎の初期症状と考えられる",
                    "evidence_refs": [
                        {
                            "stream_id": pharm_a.stream_id,
                            "segment_id": pharm_a.segment_id,
                            "segment_revision": pharm_a.segment_revision,
                            "quote": pharm_a.text,
                        }
                    ],
                },
                {
                    "action": "add",
                    "section": "P",
                    "text": "毎食後1錠を服用",
                    "evidence_refs": [
                        {
                            "stream_id": pharm_p.stream_id,
                            "segment_id": pharm_p.segment_id,
                            "segment_revision": pharm_p.segment_revision,
                            "quote": pharm_p.text,
                        }
                    ],
                },
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    p_id = added.soap.sections.P.items[0].item_id
    stale = manager.apply_finalize_a_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "text": "古いPに基づく推測",
                    "derived_from_plan_items": [{"item_id": p_id, "item_revision": 99}],
                }
            ]
        },
        segments_lookup=lookup,
        expected_plan_items={p_id: 99},
    )
    assert stale.stale_discarded is True
    assert len(stale.soap.sections.A.items) == 1
