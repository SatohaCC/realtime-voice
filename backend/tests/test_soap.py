import asyncio
from typing import Any

import pytest

from app.clients.soap_llm_client import SoapLlmClientError
from app.schemas.soap import TranscriptSegmentModel
from app.services.conversation_service import ConversationTranscriptState, DeepgramTranscriptInput
from app.services.soap_service import SoapStateManager
from tests.fake_soap_llm_client import FakeSoapLlmClient


def _evidence(seg: TranscriptSegmentModel, quote: str | None = None) -> dict[str, Any]:
    return {
        "stream_id": seg.stream_id,
        "segment_id": seg.segment_id,
        "segment_revision": seg.segment_revision,
        "quote": seg.text if quote is None else quote,
    }


@pytest.mark.parametrize("index,section", [(1, "O"), (3, "P")])
def test_fake_long_utterance_quotes_remain_literal_and_apply(index: int, section: str) -> None:
    async def _run() -> None:
        conv, _ = _setup_conversation()
        original = conv.segments[index]
        segment = original.model_copy(
            update={"text": original.text + " 詳細な\n状況を説明します。" * 12}
        )
        lookup = {(segment.stream_id, segment.segment_id): segment}
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        outcome = await manager.run_extract_soap(
            llm_client=FakeSoapLlmClient(),
            new_segments=[segment],
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert outcome.applied_operations > 0
        items = getattr(manager.note.sections, section).items
        assert items
        for item in items:
            for evidence in item.evidence:
                assert evidence.quote == segment.text[:80].strip()
                assert evidence.quote in segment.text

    asyncio.run(_run())


@pytest.mark.parametrize("mixed", [False, True])
def test_invalid_quote_rejects_whole_batch_without_advancing_revision(mixed: bool) -> None:
    conv, lookup = _setup_conversation()
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    refs = [_evidence(conv.segments[3], "毎食後に2錠服用してください。")]
    if mixed:
        refs.insert(0, _evidence(conv.segments[3]))
    with pytest.raises(SoapLlmClientError):
        manager.apply_extract_soap_raw(
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
    outcome = manager.apply_extract_soap_raw(
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
        await manager.run_extract_soap(
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
    first = manager.apply_extract_soap_raw(
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
    outcome = manager.apply_extract_soap_raw(
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
    first = manager.apply_extract_soap_raw(
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
        outcome = manager.apply_extract_soap_raw(
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

    outcome = manager.apply_extract_soap_raw(
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

    first = manager.apply_extract_soap_raw(
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
    unchanged = manager.apply_extract_soap_raw(
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
        manager.apply_extract_soap_raw(
            raw_result={"operations": [{"action": "invalid"}]},
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision,
        )

    # S -> O への欄移動と P の更新が 1 つの revision で原子適用されること
    moved = manager.apply_extract_soap_raw(
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


@pytest.mark.parametrize("section", ["S", "O"])
@pytest.mark.parametrize("action", ["add", "update", "retract", "move", "rejected"])
def test_inferred_a_tracks_so_changes_after_resume(section: str, action: str) -> None:
    async def _run() -> None:
        conv, lookup = _setup_conversation()
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        llm = FakeSoapLlmClient()
        await manager.run_extract_soap(
            llm_client=llm,
            new_segments=conv.finalized_segments,
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        manager.apply_extract_soap_raw(
            raw_result={
                "operations": [
                    {
                        "action": "add",
                        "section": "S",
                        "text": conv.segments[1].text,
                        "evidence_refs": [_evidence(conv.segments[1])],
                    }
                ]
            },
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision,
        )
        await manager.run_finalize_a_from_p(llm_client=llm, current_segments_lookup=lookup)
        before = manager.note
        assert not manager.has_stale_plan_inference()
        item = getattr(before.sections, section).items[0]
        op: dict[str, Any] = {
            "action": "update" if action in {"move", "rejected"} else action,
            "section": section,
            "item_id": "missing" if action == "rejected" else item.item_id,
            "text": "発言の訂正",
            "evidence_refs": [_evidence(conv.segments[1])],
        }
        if action == "move":
            op["target_section"] = "O" if section == "S" else "S"
        if action == "retract":
            op["retraction_reason"] = "発言の訂正"
        outcome = manager.apply_extract_soap_raw(
            raw_result={"operations": [op]},
            segments_lookup=lookup,
            processed_transcript_revision=conv.transcript_revision + 1,
        )
        expected_stale = action != "rejected"
        assert manager.has_stale_plan_inference() is expected_stale
        assert outcome.soap.sections.P == before.sections.P
        assert [i for i in outcome.soap.sections.A.items if i.origin == "conversation"] == [
            i for i in before.sections.A.items if i.origin == "conversation"
        ]
        assert outcome.soap.sections.A.revision == before.sections.A.revision + int(expected_stale)
        inferred = [i for i in outcome.soap.sections.A.items if i.origin == "plan_inference"]
        assert inferred and all(i.stale_after_plan_update is expected_stale for i in inferred)
        if expected_stale:
            await manager.run_finalize_a_from_p(llm_client=llm, current_segments_lookup=lookup)
            assert not manager.has_stale_plan_inference()

    asyncio.run(_run())


def test_fake_llm_flow_preserves_spoken_a_and_marks_stale_after_resume_p_update() -> None:
    async def _run() -> None:
        conv, lookup = _setup_conversation()
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        fake_llm = FakeSoapLlmClient()

        extract_outcome = await manager.run_extract_soap(
            llm_client=fake_llm,
            new_segments=conv.finalized_segments,
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert len(extract_outcome.soap.sections.O.items) >= 1
        assert len(extract_outcome.soap.sections.A.items) >= 1
        assert len(extract_outcome.soap.sections.P.items) >= 1
        finalize_payload = manager.build_finalize_a_payload()
        assert "s_items" in finalize_payload
        assert finalize_payload["o_items"] == [
            item.model_dump(mode="json") for item in extract_outcome.soap.sections.O.items
        ]
        assert len(finalize_payload["plan_items"]) >= 1
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
        resumed_outcome = await manager.run_extract_soap(
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


def test_s_consolidates_multiple_patient_utterances_into_single_item() -> None:
    conv = ConversationTranscriptState(conversation_id="conv-s-merge")
    conv.start_stream("stream-1")
    first_seg = conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="昨日転んでしまい腰がかなり痛くて病院行きました。",
            is_final=True,
            speech_final=True,
            start_sec=0.2,
            end_sec=2.0,
            confidence=0.95,
        )
    ).segment
    second_seg = conv.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="私朝ごはん食べないんですけど、朝薬どうしたらいいですか。",
            is_final=True,
            speech_final=True,
            start_sec=2.5,
            end_sec=4.5,
            confidence=0.95,
        )
    ).segment
    assert first_seg is not None and second_seg is not None
    lookup = {(seg.stream_id, seg.segment_id): seg for seg in conv.segments}
    manager = SoapStateManager(conversation_id=conv.conversation_id)

    first = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "S",
                    "text": "昨日転んで腰が痛く受診した。",
                    "evidence_refs": [_evidence(first_seg)],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=1,
    )
    assert len(first.soap.sections.S.items) == 1
    s_id = first.soap.sections.S.items[0].item_id

    # モデルが誤って 2 件目の add を返しても既存 S 項目へ統合され、根拠も両方保持されること
    merged = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "S",
                    "text": "朝食を食べないため朝の薬の服用方法について相談がある。",
                    "evidence_refs": [_evidence(second_seg)],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert len(merged.soap.sections.S.items) == 1
    s_item = merged.soap.sections.S.items[0]
    assert s_item.item_id == s_id
    assert s_item.item_revision == 2
    assert "昨日転んで腰が痛く受診した。" in s_item.text
    assert "朝食を食べないため朝の薬の服用方法について相談がある。" in s_item.text
    assert len(s_item.evidence) == 2

    # 通常の update でも既存 S 根拠が失われずに統合されること
    updated = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "action": "update",
                    "section": "S",
                    "item_id": s_id,
                    "text": "昨日転倒し腰痛で受診。朝食抜きのため朝薬の服用方法を相談。",
                    "evidence_refs": [_evidence(second_seg)],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=conv.transcript_revision,
    )
    assert len(updated.soap.sections.S.items) == 1
    assert updated.soap.sections.S.items[0].item_revision == 3
    assert len(updated.soap.sections.S.items[0].evidence) == 2


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

        first = await manager.run_extract_soap(
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
        second = await manager.run_extract_soap(
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
    added = manager.apply_extract_soap_raw(
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


def test_langchain_soap_llm_client_uses_pydantic_schemas_caches_and_handles_gemini(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dataclasses import replace
    from types import SimpleNamespace

    from app.clients import soap_llm_client
    from app.clients.soap_llm_client import LangChainSoapLlmClient, get_default_soap_llm_client
    from app.schemas.soap import LlmExtractSoapResult, LlmFinalizeAResult

    init_calls: list[tuple[str, dict[str, Any]]] = []
    schema_calls: list[type[Any]] = []
    invoked_messages: list[Any] = []

    class _FakeRunner:
        def __init__(self, schema: type[Any]) -> None:
            self._schema = schema

        async def ainvoke(self, messages: Any) -> Any:
            invoked_messages.append(messages)
            if self._schema is LlmExtractSoapResult:
                return LlmExtractSoapResult(operations=[])
            return LlmFinalizeAResult(operations=[])

    class _FakeModel:
        def with_structured_output(self, schema: type[Any]) -> _FakeRunner:
            schema_calls.append(schema)
            return _FakeRunner(schema)

    def _fake_init_chat_model(model: str, **kwargs: Any) -> _FakeModel:
        init_calls.append((model, kwargs))
        return _FakeModel()

    monkeypatch.setattr(
        soap_llm_client.importlib,
        "import_module",
        lambda name: SimpleNamespace(init_chat_model=_fake_init_chat_model),
    )

    async def _run() -> None:
        client = LangChainSoapLlmClient(
            provider="gemini",
            model="gemini-3.5-flash-lite",
            finalize_model="gemini-3.8-flash",
            thinking_budget=0,
            _thinking_budget_set=True,
        )
        res1 = await client.extract_soap({"new_segments": []})
        res2 = await client.extract_soap({"new_segments": []})
        res3 = await client.finalize_a_from_p({"plan_items": []})

        assert res1 == {"operations": []}
        assert res2 == {"operations": []}
        assert res3 == {"operations": []}
        assert len(init_calls) == 2
        assert init_calls[0][0] == "gemini-3.5-flash-lite"
        assert init_calls[0][1]["model_provider"] == "google_genai"
        assert "thinking_budget" not in init_calls[0][1]
        assert init_calls[0][1]["thinking_config"] == {"thinking_level": "minimal"}
        assert "temperature" not in init_calls[0][1]
        assert init_calls[1][0] == "gemini-3.8-flash"
        assert schema_calls == [LlmExtractSoapResult, LlmFinalizeAResult]

        # Gemini 2.5 Flash 系では thinking_budget=0 と temperature=0 を渡す
        flash25_client = LangChainSoapLlmClient(
            provider="google_genai",
            model="gemini-2.5-flash-lite",
            thinking_budget=0,
            _thinking_budget_set=True,
        )
        await flash25_client.extract_soap({"new_segments": []})
        assert init_calls[-1][1]["thinking_budget"] == 0
        assert init_calls[-1][1]["temperature"] == 0

        # Pro モデル名では thinking_budget=0 / thinking_config を強制せず安全に初期化する
        pro_client = LangChainSoapLlmClient(
            provider="google_genai",
            model="gemini-2.5-pro",
            thinking_budget=0,
            _thinking_budget_set=True,
        )
        await pro_client.extract_soap({"new_segments": []})
        assert "thinking_budget" not in init_calls[-1][1]
        assert "thinking_config" not in init_calls[-1][1]

    asyncio.run(_run())

    from app.core.config import _normalize_llm_provider

    assert _normalize_llm_provider(None) == "google_genai"
    assert _normalize_llm_provider("") == "google_genai"

    monkeypatch.setattr(
        soap_llm_client,
        "settings",
        replace(soap_llm_client.settings, soap_llm_provider="gemini", soap_llm_model=""),
    )
    default_client = get_default_soap_llm_client()
    assert isinstance(default_client, LangChainSoapLlmClient)

    monkeypatch.setattr(
        soap_llm_client,
        "settings",
        replace(soap_llm_client.settings, soap_llm_provider="off"),
    )
    assert get_default_soap_llm_client() is None


def test_langchain_soap_llm_client_wraps_missing_api_key_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.clients import soap_llm_client
    from app.clients.soap_llm_client import LangChainSoapLlmClient

    def _raise_value_error(_model: str, **_kwargs: Any) -> Any:
        raise ValueError("API key required")

    monkeypatch.setattr(
        soap_llm_client.importlib,
        "import_module",
        lambda name: SimpleNamespace(init_chat_model=_raise_value_error),
    )

    async def _run() -> None:
        client = LangChainSoapLlmClient(provider="google_genai", model="gemini-3.5-flash-lite")
        with pytest.raises(SoapLlmClientError) as exc_info:
            await client.extract_soap({"new_segments": []})
        assert exc_info.value.code == "LLM_NOT_CONFIGURED"

    asyncio.run(_run())


def test_extract_payload_includes_recent_context_and_trims_it_before_failing() -> None:
    async def _run() -> None:
        conv, lookup = _setup_conversation()
        manager = SoapStateManager(conversation_id=conv.conversation_id)
        payload = manager.build_extract_payload(
            new_segments=[conv.finalized_segments[-1]],
            all_final_segments=conv.finalized_segments,
            max_context_segments=2,
        )
        assert len(payload["recent_context_segments"]) == 2
        assert payload["recent_context_segments"][0]["text"] == conv.finalized_segments[1].text

        # recent_context_segments だけ削れば上限に収まる場合はエラーにせず続行する
        import json

        without_context_len = len(
            json.dumps(
                {**payload, "recent_context_segments": []},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        with_context_len = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        assert with_context_len > without_context_len
        fake = FakeSoapLlmClient(max_input_chars=without_context_len + 5)
        outcome = await manager.run_extract_soap(
            llm_client=fake,
            new_segments=[conv.finalized_segments[-1]],
            segments_snapshot_lookup=lookup,
            current_segments_lookup=lookup,
            target_processed_transcript_revision=conv.transcript_revision,
        )
        assert outcome.applied_operations == 2

    asyncio.run(_run())


@pytest.mark.parametrize("section,channel,new_role", [("S", 1, "pharmacist"), ("P", 0, "patient")])
def test_reconcile_retracts_whole_summary_when_one_of_two_speakers_changes(
    section: str, channel: int, new_role: str
) -> None:
    conv = ConversationTranscriptState(conversation_id="summary-correction")
    conv.start_stream("s1")
    for start, text in enumerate(("頭が痛いです", "吐き気があります")):
        conv.apply_deepgram_event(
            DeepgramTranscriptInput(channel, text, True, True, start * 2, start * 2 + 1, 0.9)
        )
    first, second = conv.finalized_segments
    manager = SoapStateManager(conversation_id=conv.conversation_id)
    added = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "section": section,
                    "action": "add",
                    "text": "頭痛と吐き気。",
                    "evidence_refs": [_evidence(first), _evidence(second)],
                }
            ]
        },
        segments_lookup={(s.stream_id, s.segment_id): s for s in conv.finalized_segments},
        processed_transcript_revision=conv.transcript_revision,
    )
    item_id = getattr(added.soap.sections, section).items[0].item_id
    corrected = second.model_copy(update={"speaker_role": new_role, "segment_revision": 2})
    outcome = manager.reconcile_transcript_segments(
        {
            (first.stream_id, first.segment_id): first,
            (second.stream_id, second.segment_id): corrected,
        }
    )
    assert getattr(outcome.soap.sections, section).items == []
    assert item_id in outcome.retracted_item_ids


def test_unknown_speaker_blocked_and_reconcile_retracts_invalidated_soap_items() -> None:
    from app.schemas.soap import TranscriptSegmentModel

    conv = ConversationTranscriptState(conversation_id="conv-reconcile")
    conv.start_stream("s1")
    patient_seg = TranscriptSegmentModel(
        stream_id="s1",
        segment_id="seg-1",
        segment_revision=1,
        transcript_revision=1,
        channel_index=1,
        speaker_role="patient",
        speaker_label="患者",
        text="昨日から胃が痛いです",
        status="final",
        start_sec=0.2,
        end_sec=1.6,
        confidence=0.95,
    )
    unknown_seg = TranscriptSegmentModel(
        stream_id="s1",
        segment_id="seg-2",
        segment_revision=1,
        transcript_revision=2,
        channel_index=0,
        speaker_role="unknown",
        speaker_label="話者不明",
        text="別の薬局でもらいました",
        status="final",
        start_sec=2.0,
        end_sec=3.0,
        confidence=0.9,
    )
    lookup = {
        ("s1", "seg-1"): patient_seg,
        ("s1", "seg-2"): unknown_seg,
    }
    manager = SoapStateManager(conversation_id="conv-reconcile")

    # 1. unknown のみの根拠で S へ追加しようとしても拒否される
    rejected = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "S",
                    "text": "別の薬局での処方あり",
                    "evidence_refs": [
                        {
                            "stream_id": "s1",
                            "segment_id": "seg-2",
                            "segment_revision": 1,
                            "quote": "別の薬局でもらいました",
                        }
                    ],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=2,
    )
    assert rejected.rejected_operations == 1
    assert rejected.soap.sections.S.items == []

    # 2. patient 根拠で S を生成したあと、後から話者が pharmacist に訂正されると自動撤回される
    added = manager.apply_extract_soap_raw(
        raw_result={
            "operations": [
                {
                    "action": "add",
                    "section": "S",
                    "text": "昨日からの胃痛を訴え",
                    "evidence_refs": [
                        {
                            "stream_id": "s1",
                            "segment_id": "seg-1",
                            "segment_revision": 1,
                            "quote": "昨日から胃が痛いです",
                        }
                    ],
                }
            ]
        },
        segments_lookup=lookup,
        processed_transcript_revision=2,
    )
    assert len(added.soap.sections.S.items) == 1
    s_item_id = added.soap.sections.S.items[0].item_id

    corrected_lookup = {
        ("s1", "seg-1"): patient_seg.model_copy(
            update={
                "segment_revision": 2,
                "speaker_role": "pharmacist",
                "speaker_label": "薬剤師",
                "status": "refined",
            }
        ),
        ("s1", "seg-2"): unknown_seg,
    }
    reconciled = manager.reconcile_transcript_segments(corrected_lookup)
    assert s_item_id in reconciled.retracted_item_ids
    assert reconciled.soap.sections.S.items == []
    assert reconciled.soap.revision > added.soap.revision
