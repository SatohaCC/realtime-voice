from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SelectedSpeakerAudio:
    """改変しない連続音声と、抽出可否の判断に使う品質情報。"""

    pcm16_bytes: bytes
    voiced_sec: float
    clipped_fraction: float


def select_speaker_audio(
    pcm16_bytes: bytes,
    *,
    sample_rate: int,
    channels: int = 1,
    channel_index: int = 0,
    min_rms: float = 0.010,
) -> SelectedSpeakerAudio:
    """20ms単位で品質を計測する。低音量部分を削除・連結せず波形を保つ。"""
    if sample_rate <= 0 or channels not in {1, 2} or not 0 <= channel_index < channels:
        return SelectedSpeakerAudio(b"", 0.0, 0.0)
    usable = len(pcm16_bytes) // (2 * channels) * (2 * channels)
    samples = np.frombuffer(pcm16_bytes[:usable], dtype="<i2")[channel_index::channels]
    if not samples.size:
        return SelectedSpeakerAudio(b"", 0.0, 0.0)
    values = samples.astype(np.float32) / 32768.0
    clipped = np.abs(values) >= 0.98
    frame_size = max(1, round(sample_rate * 0.02))
    voiced_frames = 0
    for start in range(0, len(samples), frame_size):
        frame = values[start : start + frame_size]
        if float(np.sqrt(np.mean(frame**2))) < min_rms:
            continue
        if float(np.mean(clipped[start : start + frame_size])) >= 0.01:
            continue
        voiced_frames += len(frame)
    selected = samples.tobytes() if voiced_frames else b""
    return SelectedSpeakerAudio(selected, voiced_frames / sample_rate, float(np.mean(clipped)))
