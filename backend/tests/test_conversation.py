import array

from app.services.conversation_service import (
    BackendAudioLevelHistory,
    ConversationTranscriptState,
    DeepgramTranscriptInput,
    compute_pcm16_channel_rms,
)


def _make_stereo_pcm16(*, left_amp: int, right_amp: int, samples_per_channel: int = 1600) -> bytes:
    buf = array.array("h")
    for _ in range(samples_per_channel):
        buf.append(left_amp)
        buf.append(right_amp)
    return buf.tobytes()


def test_fixed_role_mapping_and_interim_to_final_revision() -> None:
    state = ConversationTranscriptState(conversation_id="conv-1")
    stream_id = state.start_stream("stream-a")
    assert stream_id == "stream-a"

    interim = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="頭が痛くて",
            is_final=False,
            speech_final=False,
            start_sec=1.0,
            end_sec=1.5,
            confidence=0.8,
        )
    )
    assert interim.segment is not None
    assert interim.segment.speaker_role == "patient"
    assert interim.segment.speaker_label == "患者"
    assert interim.segment.status == "interim"
    assert interim.segment.segment_revision == 1
    assert interim.segment.transcript_revision == 1

    final = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="頭が痛くて昨日からつらいです",
            is_final=True,
            speech_final=True,
            start_sec=1.0,
            end_sec=2.4,
            confidence=0.95,
        )
    )
    assert final.segment is not None
    assert final.is_new_final is True
    assert final.segment.segment_id == interim.segment.segment_id
    assert final.segment.segment_revision == 2
    assert final.segment.transcript_revision == 2
    assert final.segment.status == "final"


def test_crosstalk_duplicate_suppressed_with_pcm_history_and_archived() -> None:
    state = ConversationTranscriptState(conversation_id="conv-2")
    state.start_stream("stream-1")
    pcm = _make_stereo_pcm16(left_amp=6000, right_amp=200, samples_per_channel=32000)
    state.append_pcm16(pcm, channels=2, sample_rate=16000)

    pharm = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="毎日 朝食後に 1 錠 飲んでください",
            is_final=True,
            speech_final=True,
            start_sec=0.1,
            end_sec=1.8,
            confidence=0.94,
        )
    )
    assert pharm.segment is not None
    assert pharm.segment.speaker_role == "pharmacist"

    bleed_interim = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="毎日 朝食後に",
            is_final=False,
            speech_final=False,
            start_sec=0.2,
            end_sec=1.0,
            confidence=0.6,
        )
    )
    assert bleed_interim.segment is not None

    bleed_final = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="毎日朝食後に1錠飲んでください",
            is_final=True,
            speech_final=True,
            start_sec=0.2,
            end_sec=1.7,
            confidence=0.72,
        )
    )
    assert bleed_final.suppressed_crosstalk is True
    assert bleed_final.removed is True
    assert bleed_final.segment is not None
    assert bleed_final.segment.segment_id == bleed_interim.segment.segment_id
    assert len(state.segments) == 1
    assert len(state.suppressed_candidates) == 1


def test_missing_audio_history_and_non_overlapping_backchannel_are_preserved() -> None:
    history = BackendAudioLevelHistory()
    assert history.levels_for(0.0, 1.0) == (0.0, 0.0)
    assert compute_pcm16_channel_rms(b"", channels=2) == (0.0, 0.0)

    state = ConversationTranscriptState(conversation_id="conv-3")
    state.start_stream("stream-1")

    state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="はい",
            is_final=True,
            speech_final=True,
            start_sec=0.1,
            end_sec=0.5,
            confidence=0.9,
        )
    )
    backchannel = state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="はい",
            is_final=True,
            speech_final=True,
            start_sec=0.8,
            end_sec=1.2,
            confidence=0.9,
        )
    )
    assert backchannel.suppressed_crosstalk is False
    assert [seg.speaker_role for seg in state.segments] == ["pharmacist", "patient"]


def test_simultaneous_speech_ordered_by_audio_time_and_stream_resume() -> None:
    state = ConversationTranscriptState(conversation_id="conv-4")
    state.start_stream("s1")
    state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="あとから届くが先に話した発話",
            is_final=True,
            speech_final=True,
            start_sec=0.5,
            end_sec=1.5,
            confidence=0.9,
        )
    )
    state.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="先に届いたが後ろの時刻の発話",
            is_final=True,
            speech_final=True,
            start_sec=2.0,
            end_sec=3.0,
            confidence=0.9,
        )
    )
    # 順番をテストするため逆順で入った場合も start_sec で並ぶことを確認
    state2 = ConversationTranscriptState(conversation_id="conv-5")
    state2.start_stream("s1")
    state2.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="2秒目",
            is_final=True,
            speech_final=True,
            start_sec=2.0,
            end_sec=2.5,
            confidence=0.9,
        )
    )
    state2.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=1,
            text="0.5秒目",
            is_final=True,
            speech_final=True,
            start_sec=0.5,
            end_sec=1.2,
            confidence=0.9,
        )
    )
    state2.start_stream("s2")
    state2.apply_deepgram_event(
        DeepgramTranscriptInput(
            channel_index=0,
            text="再開後の0.2秒目",
            is_final=True,
            speech_final=True,
            start_sec=0.2,
            end_sec=0.9,
            confidence=0.9,
        )
    )
    assert [seg.text for seg in state2.segments] == ["0.5秒目", "2秒目", "再開後の0.2秒目"]
