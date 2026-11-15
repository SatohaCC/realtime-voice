import asyncio

import pytest

from app.services.conversation_service import ConversationTranscriptState, DeepgramTranscriptInput
from app.services.soap_stream_service import (
    ConversationSessionRegistry,
    set_conversation_segment_enabled,
)
from tests.fake_soap_llm_client import FakeSoapLlmClient


@pytest.mark.parametrize("order", [(0, 1), (1, 0)])
def test_system_duplicates_are_removed_but_user_disable_keeps_original(
    order: tuple[int, int],
) -> None:
    state = ConversationTranscriptState(conversation_id="system-duplicate")
    stream = state.start_stream()
    vector = [1.0] + [0.0] * 31
    assert state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=vector
    )[0]
    state.append_audio_levels(duration_sec=2, levels=(0.1, 0.01))
    for channel in order:
        outcome = state.apply_deepgram_event(
            DeepgramTranscriptInput(channel, "朝食後に服用してください", True, True, 0, 1.5, 0.9),
            segment_embedding=vector,
        )
    assert outcome.suppressed_crosstalk
    assert len(state.segments) == 1
    kept = state.segments[0]
    assert kept.channel_index == 0
    assert not kept.disabled
    if order == (1, 0):
        assert len(outcome.removed_segments) == 1
        assert outcome.removed_segments[0].channel_index == 1
    disabled = state.set_segment_enabled(
        stream_id=stream, segment_id=kept.segment_id, enabled=False
    )
    assert disabled is not None and disabled.disabled
    assert state.segments == [disabled]


def test_disabling_preserves_source_and_reenabling_restores_soap_input() -> None:
    state = ConversationTranscriptState(conversation_id="audit")
    stream = state.start_stream()
    result = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "頭が痛い", True, True, 0, 1, 0.9)
    )
    original = result.segment
    assert original is not None
    disabled = state.set_segment_enabled(
        stream_id=stream, segment_id=original.segment_id, enabled=False
    )
    assert disabled is not None and disabled.disabled
    assert len(state.segments) == 1
    assert (disabled.text, disabled.start_sec, disabled.end_sec) == (original.text, 0, 1)
    assert state.finalized_segments == []
    enabled = state.set_segment_enabled(
        stream_id=stream, segment_id=original.segment_id, enabled=True
    )
    assert enabled is not None and not enabled.disabled
    assert state.finalized_segments == [enabled]
    assert enabled.segment_revision > disabled.segment_revision


def test_unverified_speech_is_assigned_to_patient() -> None:
    state = ConversationTranscriptState(conversation_id="fallback")
    state.start_stream()
    assert state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=[1.0] + [0.0] * 31
    )[0]
    result = state.apply_deepgram_event(DeepgramTranscriptInput(0, "はい", True, True, 0, 0.3, 0.9))
    assert result.segment is not None
    assert result.segment.speaker_role == "patient"


def test_disabled_original_is_not_used_to_suppress_incoming_speech() -> None:
    state = ConversationTranscriptState(conversation_id="excluded")
    stream = state.start_stream()
    state.append_audio_levels(duration_sec=3, levels=(0.1, 0.01))
    first = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "毎日朝食後に一錠飲んでください", True, True, 0, 2, 0.9)
    ).segment
    assert first is not None
    state.set_segment_enabled(stream_id=stream, segment_id=first.segment_id, enabled=False)
    incoming = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, first.text, True, True, 0, 2, 0.9)
    )
    assert incoming.segment is not None and not incoming.segment.disabled
    assert not incoming.suppressed_crosstalk
    assert len(state.segments) == 2


def test_soap_is_rebuilt_without_disabled_facts_and_restored_when_reenabled() -> None:
    async def run() -> None:
        registry = ConversationSessionRegistry()
        record = registry.get_or_create(user_id="u", conversation_id="audit")
        state = record.transcript_state
        stream = state.start_stream()
        first = state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "頭が痛いです。", True, True, 0, 1, 0.9)
        ).segment
        second = state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "吐き気があります。", True, True, 2, 3, 0.9)
        ).segment
        assert first is not None and second is not None
        record.soap_manager.apply_extract_soap_raw(
            raw_result={
                "operations": [
                    {
                        "action": "add",
                        "section": "S",
                        "text": "頭痛と吐き気がある。",
                        "evidence_refs": [
                            {
                                "stream_id": stream,
                                "segment_id": seg.segment_id,
                                "segment_revision": seg.segment_revision,
                                "quote": seg.text,
                            }
                            for seg in [first, second]
                        ],
                    }
                ]
            },
            segments_lookup={(stream, seg.segment_id): seg for seg in [first, second]},
            processed_transcript_revision=second.transcript_revision,
        )
        for enabled in [False, True]:
            result = await set_conversation_segment_enabled(
                user_id="u",
                conversation_id="audit",
                stream_id=stream,
                segment_id=second.segment_id,
                enabled=enabled,
                registry=registry,
                llm_client=FakeSoapLlmClient(),
            )
            assert result is not None
            segment, outcome, _ = result
            assert segment.disabled is not enabled
            assert len(state.segments) == 2
            text = "".join(item.text for item in outcome.soap.sections.S.items)
            assert "頭" in text
            assert ("吐き気" in text) is enabled
            assert (
                all(
                    ev.segment_id != second.segment_id
                    for item in outcome.soap.sections.S.items
                    for ev in item.evidence
                )
                if not enabled
                else True
            )

    asyncio.run(run())
