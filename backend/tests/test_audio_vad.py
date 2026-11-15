import array

from app.services.audio_vad_service import (
    AudioActivityGate,
    AudioGateConfig,
    compute_pcm16_channel_rms,
    mix_stereo_pcm16_to_mono,
)


def _stereo_pcm16(
    *, left_amp: int, right_amp: int, duration_ms: int, sample_rate: int = 16000
) -> bytes:
    frames = int(sample_rate * duration_ms / 1000)
    buf = array.array("h")
    for _ in range(frames):
        buf.append(left_amp)
        buf.append(right_amp)
    return buf.tobytes()


def test_mix_stereo_pcm16_to_mono_preserves_single_channel_and_clamps_peaks() -> None:
    single = _stereo_pcm16(left_amp=5000, right_amp=0, duration_ms=10)
    mixed = mix_stereo_pcm16_to_mono(single)
    mono_samples = array.array("h")
    mono_samples.frombytes(mixed)
    assert len(mono_samples) == 160
    assert mono_samples[0] == 5000
    assert compute_pcm16_channel_rms(mixed, channels=1)[0] > 0.1

    clipped = mix_stereo_pcm16_to_mono(
        _stereo_pcm16(left_amp=25000, right_amp=25000, duration_ms=10)
    )
    clipped_samples = array.array("h")
    clipped_samples.frombytes(clipped)
    assert clipped_samples[0] == 32767


def test_audio_activity_gate_skips_silence_prepends_preroll_and_maps_speaker_timeline() -> None:
    gate = AudioActivityGate(
        AudioGateConfig(
            sample_rate=16000,
            input_channels=2,
            output_channels=1,
            vad_enabled=True,
            rms_threshold=0.01,
            preroll_ms=200,
            hangover_ms=300,
            capture_utterances=True,
        )
    )

    # 0.0〜1.0s は無音（最後の 0.2s だけプリロールとして保持され、送信はスキップ）
    for _ in range(10):
        res = gate.process_pcm16(_stereo_pcm16(left_amp=10, right_amp=10, duration_ms=100))
        assert res.emit_pcm16 == b""
        assert res.is_speech_active is False
    assert gate.stt_clock_sec == 0.0
    assert abs(gate.real_clock_sec - 1.0) < 1e-6

    # 1.0〜1.3s に患者（ch1）が発話 → プリロール 0.2s 分 + 現チャンクがまとめて出る
    first_speech = gate.process_pcm16(_stereo_pcm16(left_amp=50, right_amp=5000, duration_ms=100))
    assert first_speech.is_speech_active is True
    # プリロール 200ms (2チャンク=100ms*2) + 現在 100ms = 300ms 分の 1ch PCM (9600 bytes)
    assert len(first_speech.emit_pcm16) == 9600
    assert first_speech.dominant_channel == 1

    for _ in range(2):
        res = gate.process_pcm16(_stereo_pcm16(left_amp=50, right_amp=5000, duration_ms=100))
        assert len(res.emit_pcm16) == 3200
        assert res.is_speech_active is True

    # 1.3〜1.6s は無音（ハングオーバー 300ms で語尾はそのまま送り、300ms 到達時に発話終了）
    hang1 = gate.process_pcm16(_stereo_pcm16(left_amp=10, right_amp=10, duration_ms=100))
    hang2 = gate.process_pcm16(_stereo_pcm16(left_amp=10, right_amp=10, duration_ms=100))
    hang3 = gate.process_pcm16(_stereo_pcm16(left_amp=10, right_amp=10, duration_ms=100))
    assert len(hang1.emit_pcm16) == 3200
    assert len(hang2.emit_pcm16) == 3200
    assert len(hang3.emit_pcm16) == 3200
    assert hang3.is_speech_active is False
    assert hang3.just_ended_utterance is True
    assert hang3.completed_utterance is not None
    assert hang3.completed_utterance.dominant_channel == 1
    assert abs(hang3.completed_utterance.real_start_sec - 0.8) < 1e-6
    assert abs(hang3.completed_utterance.real_end_sec - 1.6) < 1e-6

    # STT 累積タイムラインの [0.2, 0.5] は実時刻の [1.0, 1.3]（患者発話）に対応すること
    resolved = gate.resolve_stt_interval(0.2, 0.5)
    assert resolved is not None
    assert resolved.dominant_channel == 1
    assert abs(resolved.real_start_sec - 1.0) < 1e-6
    assert abs(resolved.real_end_sec - 1.3) < 1e-6

    # 1.6〜2.6s 無音を挟んだ後、2.6〜2.8s で薬剤師（ch0）が発話
    for _ in range(10):
        res = gate.process_pcm16(_stereo_pcm16(left_amp=10, right_amp=10, duration_ms=100))
        assert res.emit_pcm16 == b""

    pharm1 = gate.process_pcm16(_stereo_pcm16(left_amp=7000, right_amp=50, duration_ms=100))
    pharm2 = gate.process_pcm16(_stereo_pcm16(left_amp=7000, right_amp=50, duration_ms=100))
    assert pharm1.is_speech_active is True
    assert pharm2.dominant_channel == 0

    # 1回目の有効区間は 0.8s (0.2s+0.3s+0.3s) のため、2回目は stt [1.0, 1.2] -> real [2.6, 2.8]
    resolved_pharm = gate.resolve_stt_interval(1.0, 1.2)
    assert resolved_pharm is not None
    assert resolved_pharm.dominant_channel == 0
    assert abs(resolved_pharm.real_start_sec - 2.6) < 1e-6
    assert abs(resolved_pharm.real_end_sec - 2.8) < 1e-6


def test_audio_activity_gate_passthrough_when_vad_disabled() -> None:
    gate = AudioActivityGate(
        AudioGateConfig(
            sample_rate=16000,
            input_channels=2,
            output_channels=2,
            vad_enabled=False,
        )
    )
    silence = _stereo_pcm16(left_amp=0, right_amp=0, duration_ms=100)
    res = gate.process_pcm16(silence)
    assert res.emit_pcm16 == silence
    assert res.is_speech_active is True
