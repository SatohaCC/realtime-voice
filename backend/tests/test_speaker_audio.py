import struct

from app.services.speaker_audio_service import select_speaker_audio


def _pcm(value: int, seconds: float) -> bytes:
    return struct.pack("<h", value) * int(16000 * seconds)


def test_tracks_quality_without_stitching_or_altering_the_waveform() -> None:
    pcm = _pcm(0, 0.2) + _pcm(3000, 0.8) + _pcm(32767, 0.2)
    result = select_speaker_audio(pcm, sample_rate=16000)
    assert result.pcm16_bytes == pcm
    assert result.voiced_sec == 0.8
    assert result.clipped_fraction > 0.1


def test_retains_low_energy_phonemes_and_pauses_inside_speech() -> None:
    pcm = _pcm(3000, 0.3) + _pcm(100, 0.2) + _pcm(0, 0.1) + _pcm(3000, 0.3)
    result = select_speaker_audio(pcm, sample_rate=16000)
    assert result.pcm16_bytes == pcm
    assert result.voiced_sec == 0.6


def test_stereo_selection_does_not_mix_channels() -> None:
    pcm = struct.pack("<hh", 0, 3000) * 16000
    assert not select_speaker_audio(pcm, sample_rate=16000, channels=2).pcm16_bytes
    selected = select_speaker_audio(pcm, sample_rate=16000, channels=2, channel_index=1)
    assert selected.pcm16_bytes == _pcm(3000, 1)
