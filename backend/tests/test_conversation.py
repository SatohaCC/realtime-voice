import array

import pytest

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


@pytest.mark.parametrize(
    "text,start,end,right_amp",
    [
        ("はい。", 0.1, 0.5, 200),
        ("いいえ。", 0.1, 0.5, 200),
        ("毎日朝食後に1錠飲んでください", 1.7, 2.0, 200),
        ("毎日朝食後に1錠飲んでください", 0.1, 1.8, 3500),
    ],
)
def test_ambiguous_crosstalk_preserves_short_replies_and_overlapping_speech(
    text: str, start: float, end: float, right_amp: int
) -> None:
    state = ConversationTranscriptState(conversation_id="conv-preserve")
    state.start_stream()
    state.append_pcm16(
        _make_stereo_pcm16(left_amp=6000, right_amp=right_amp, samples_per_channel=32000),
        channels=2,
        sample_rate=16000,
    )
    state.apply_deepgram_event(DeepgramTranscriptInput(0, text, True, True, 0.1, 1.8, 0.95))
    reply = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, text, True, True, start, end, 0.95)
    )
    assert not reply.suppressed_crosstalk
    assert [seg.speaker_role for seg in state.finalized_segments] == ["pharmacist", "patient"]


def test_pcm_ring_buffer_slices_and_clears() -> None:
    from app.services.conversation_service import BackendAudioPcmRingBuffer

    ring = BackendAudioPcmRingBuffer(max_history_seconds=5.0)
    chunk_1s = _make_stereo_pcm16(left_amp=4000, right_amp=200, samples_per_channel=16000)
    ring.append_pcm16(chunk_1s, channels=2, sample_rate=16000)
    ring.append_pcm16(chunk_1s, channels=2, sample_rate=16000)

    sliced = ring.slice_pcm16(0.5, 1.5)
    assert sliced is not None
    pcm_bytes, channels, sr = sliced
    assert channels == 2
    assert sr == 16000
    assert len(pcm_bytes) == 16000 * 2 * 2
    assert ring.slice_pcm16(1.5, 3.0) is None

    ring.clear()
    assert ring.slice_pcm16(0.5, 1.5) is None


@pytest.mark.parametrize("valid_profile", [True, False])
def test_voiceprint_interims_and_rejected_profiles_do_not_guess_roles(valid_profile: bool) -> None:
    state = ConversationTranscriptState(conversation_id="no-guesses")
    state.start_stream()
    model_id = (
        "3dspeaker_campplus_zh_en_16k_contiguous_v2"
        if valid_profile
        else "3dspeaker_campplus_zh_en_16k"
    )
    accepted, _ = state.set_pharmacist_profile(model_id=model_id, embedding=[1.0] + [0.0] * 31)
    assert accepted is valid_profile
    state.append_audio_levels(duration_sec=3, levels=(0.01, 0.2))
    for is_final in [False, True]:
        result = state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "飲み方を確認します", is_final, is_final, 0, 2, 0.9)
        )
        assert result.segment is not None
        assert result.segment.speaker_role == "unknown"


def test_voiceprint_crosstalk_integration_and_delayed_short_refinement() -> None:
    from app.services.speaker_service import normalize_embedding

    pharm_vec = normalize_embedding([1.0] + [0.0] * 31)
    patient_vec = normalize_embedding([0.0, 1.0] + [0.0] * 30)
    assert pharm_vec is not None
    assert patient_vec is not None

    state = ConversationTranscriptState(conversation_id="conv-voiceprint")
    state.start_stream("s1")
    ok, _ = state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=pharm_vec
    )
    assert ok is True

    # 3.0秒のステレオ音声: ch0=大, ch1=小（回り込み）
    state.append_pcm16(
        _make_stereo_pcm16(left_amp=5000, right_amp=1500, samples_per_channel=48000),
        channels=2,
        sample_rate=16000,
    )

    # 1. ch0 で薬剤師が話す
    out1 = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "お薬の飲み方はお変わりないですか", True, True, 0.0, 1.8, 0.95),
        segment_embedding=pharm_vec,
    )
    assert out1.segment is not None
    assert out1.segment.speaker_role == "pharmacist"

    # 2. ch1 に語尾違い・境界ズレの回り込みが入っても同一話者声紋＋音量劣位で統合除外する
    out_bleed = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "お薬の飲み方はお変わりありませんか", True, True, 0.1, 1.7, 0.8),
        segment_embedding=pharm_vec,
    )
    assert out_bleed.suppressed_crosstalk is True
    assert len(state.finalized_segments) == 1

    # 3. 直前に短い unknown が残っても、直後の患者高信頼発話で refined 再判定される
    state_ref = ConversationTranscriptState(conversation_id="conv-refine")
    state_ref.start_stream("s1")
    assert state_ref.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=pharm_vec
    )[0]
    # 前半0.4秒は ch0/ch1 拮抗（unknown になりやすい短発話）、後半2秒は ch1 優位（患者確定）
    state_ref.append_pcm16(
        _make_stereo_pcm16(left_amp=2000, right_amp=2200, samples_per_channel=16000),
        channels=2,
        sample_rate=16000,
    )
    state_ref.append_pcm16(
        _make_stereo_pcm16(left_amp=300, right_amp=4500, samples_per_channel=40000),
        channels=2,
        sample_rate=16000,
    )
    short_out = state_ref.apply_deepgram_event(
        DeepgramTranscriptInput(1, "はい", True, True, 0.1, 0.4, 0.9),
        segment_embedding=None,
    )
    assert short_out.segment is not None
    assert short_out.segment.speaker_role == "unknown"

    anchor_out = state_ref.apply_deepgram_event(
        DeepgramTranscriptInput(1, "毎朝しっかり飲めています", True, True, 1.1, 2.8, 0.95),
        segment_embedding=patient_vec,
    )
    assert anchor_out.segment is not None
    assert anchor_out.segment.speaker_role == "patient"
    # 直後の話者が判明しても、音量が拮抗した別区間の話者を推測で変更しない
    assert anchor_out.refined_segments == ()
    assert state_ref.finalized_segments[0].speaker_role == "unknown"


def test_accumulated_short_audio_refines_only_with_embedding_and_resets_on_stream() -> None:
    state = ConversationTranscriptState(conversation_id="short-pool")
    state.start_stream()
    vec = [1.0] + [0.0] * 31
    assert state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=vec
    )[0]
    state.append_audio_levels(duration_sec=3, levels=(0.1, 0.01))
    first = DeepgramTranscriptInput(0, "はい", True, True, 0.0, 0.35, 0.9)
    second = DeepgramTranscriptInput(0, "そうです", True, True, 0.4, 0.75, 0.9)
    assert not state.needs_speaker_embedding(first)
    state.apply_deepgram_event(first)
    assert state.finalized_segments[0].speaker_role == "unknown"
    assert state.needs_speaker_embedding(second)
    assert state.speaker_embedding_interval(second) == (0.0, 0.75)
    result = state.apply_deepgram_event(second, segment_embedding=vec)
    assert result.segment is not None and result.segment.speaker_role == "pharmacist"
    assert len(result.refined_segments) == 1
    assert result.refined_segments[0].speaker_role == "pharmacist"
    state.start_stream()
    state.append_audio_levels(duration_sec=3, levels=(0.1, 0.01))
    assert not state.needs_speaker_embedding(second)


@pytest.mark.parametrize(
    "other_channel,gap,levels",
    [(True, 0.05, (0.1, 0.01)), (False, 1.0, (0.1, 0.01)), (False, 0.05, (0.1, 0.09))],
)
def test_short_pool_excludes_interruptions_long_gaps_and_ambiguous_levels(
    other_channel: bool, gap: float, levels: tuple[float, float]
) -> None:
    state = ConversationTranscriptState(conversation_id="short-safe")
    state.start_stream()
    assert state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=[1.0] + [0.0] * 31
    )[0]
    state.append_audio_levels(duration_sec=3, levels=levels)
    state.apply_deepgram_event(DeepgramTranscriptInput(0, "はい", True, True, 0, 0.35, 0.9))
    if other_channel:
        state.apply_deepgram_event(DeepgramTranscriptInput(1, "ええ", True, True, 0.1, 0.3, 0.9))
    event = DeepgramTranscriptInput(0, "そうです", True, True, 0.35 + gap, 0.7 + gap, 0.9)
    assert not state.needs_speaker_embedding(event)


def test_voiceprint_deduplicates_same_speaker_bleed_regardless_of_order_length_and_kana() -> None:
    from app.services.speaker_service import normalize_embedding

    pharm_vec = normalize_embedding([1.0] + [0.0] * 31)
    patient_vec = normalize_embedding([0.0, 1.0] + [0.0] * 30)
    assert pharm_vec is not None
    assert patient_vec is not None

    state = ConversationTranscriptState(conversation_id="conv-dup-sym")
    state.start_stream("s1")
    assert state.set_pharmacist_profile(
        model_id="3dspeaker_campplus_zh_en_16k_contiguous_v2", embedding=pharm_vec
    )[0]

    # 近接マイク配置を模擬: ch0=4200, ch1=3800（音量比 1.11 倍で従来の 1.8 倍未満）
    state.append_pcm16(
        _make_stereo_pcm16(left_amp=4200, right_amp=3800, samples_per_channel=128000),
        channels=2,
        sample_rate=16000,
    )

    # 1. 同音・ほぼ同音量の両 ch 「こんにちは。」を重複統合し 1 件だけ残す
    a0 = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "こんにちは。", True, True, 0.0, 0.9, 0.92),
        segment_embedding=pharm_vec,
    )
    a1 = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "こんにちは。", True, True, 0.0, 0.9, 0.91),
        segment_embedding=pharm_vec,
    )
    assert a0.segment is not None
    assert a1.suppressed_crosstalk is True
    assert [seg.text for seg in state.finalized_segments] == ["こんにちは。"]

    # 2. ch1 側（誤変換「シャブンに」）が先着しても、後着 ch0（「処分に」）で置換統合される
    b1_bleed = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "シャブンに", True, True, 2.2, 3.1, 0.72),
        segment_embedding=pharm_vec,
    )
    assert b1_bleed.segment is not None
    assert b1_bleed.segment.text == "シャブンに"

    b0_clean = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "処分に", True, True, 2.2, 3.1, 0.94),
        segment_embedding=pharm_vec,
    )
    assert b0_clean.segment is not None
    assert b0_clean.segment.text == "処分に"
    assert len(b0_clean.removed_segments) == 1
    assert b0_clean.removed_segments[0].segment_id == b1_bleed.segment.segment_id
    assert [seg.text for seg in state.finalized_segments] == ["こんにちは。", "処分に"]

    # 3. 短尺 unknown（「できてますか。」）が先着し、薬剤師発話が後着した場合は unknown 側を回収する
    c1_unknown = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "できてますか。", True, True, 5.0, 5.6, 0.85),
        segment_embedding=None,
    )
    assert c1_unknown.segment is not None
    assert c1_unknown.segment.speaker_role == "unknown"

    c0_pharm = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "できてますか今お薬は", True, True, 5.1, 6.8, 0.95),
        segment_embedding=pharm_vec,
    )
    assert c0_pharm.segment is not None
    assert len(c0_pharm.removed_segments) == 1
    assert c0_pharm.removed_segments[0].segment_id == c1_unknown.segment.segment_id
    assert [seg.text for seg in state.finalized_segments] == [
        "こんにちは。",
        "処分に",
        "できてますか今お薬は",
    ]

    # 4. 同時刻に「患者の声紋」として別話者判定された発話（および非類似の短返答）は保持する
    state.append_pcm16(
        _make_stereo_pcm16(left_amp=800, right_amp=4500, samples_per_channel=32000),
        channels=2,
        sample_rate=16000,
    )
    p_init = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "先月も同じお薬でした", True, True, 8.2, 9.8, 0.94),
        segment_embedding=patient_vec,
    )
    assert p_init.segment is not None
    assert p_init.segment.speaker_role == "patient"

    d0 = state.apply_deepgram_event(
        DeepgramTranscriptInput(0, "副作用はありませんか", True, True, 7.0, 8.5, 0.95),
        segment_embedding=pharm_vec,
    )
    d1_patient = state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "はい大丈夫です", True, True, 7.2, 8.2, 0.92),
        segment_embedding=patient_vec,
    )
    assert d0.segment is not None
    assert d1_patient.suppressed_crosstalk is False
    patient_segments = [s for s in state.finalized_segments if s.text == "はい大丈夫です"]
    assert len(patient_segments) == 1
    assert patient_segments[0].speaker_role == "patient"
