import array
import math
from collections import deque
from dataclasses import dataclass
from typing import Literal


def compute_pcm16_channel_rms(pcm16_bytes: bytes, *, channels: int) -> tuple[float, float]:
    """16bit リトルエンディアン PCM からチャンネルごとの正規化 RMS (0.0〜1.0) を算出する。"""
    if channels not in {1, 2} or len(pcm16_bytes) < 2:
        return (0.0, 0.0)

    usable_len = len(pcm16_bytes) - (len(pcm16_bytes) % (2 * channels))
    if usable_len <= 0:
        return (0.0, 0.0)

    samples = array.array("h")
    samples.frombytes(pcm16_bytes[:usable_len])
    frame_count = len(samples) // channels
    if frame_count <= 0:
        return (0.0, 0.0)

    if channels == 1:
        sum_sq = sum(float(sample) * float(sample) for sample in samples)
        rms0 = min(1.0, math.sqrt(sum_sq / frame_count) / 32768.0)
        return (rms0, 0.0)

    sum_sq_0 = 0.0
    sum_sq_1 = 0.0
    for idx in range(0, len(samples), 2):
        left = float(samples[idx])
        right = float(samples[idx + 1])
        sum_sq_0 += left * left
        sum_sq_1 += right * right
    rms0 = min(1.0, math.sqrt(sum_sq_0 / frame_count) / 32768.0)
    rms1 = min(1.0, math.sqrt(sum_sq_1 / frame_count) / 32768.0)
    return (rms0, rms1)


def mix_stereo_pcm16_to_mono(pcm16_bytes: bytes) -> bytes:
    """2ch 16bit リトルエンディアン PCM を 1ch モノラル PCM16 へ飽和加算で合成する。"""
    usable_len = len(pcm16_bytes) - (len(pcm16_bytes) % 4)
    if usable_len <= 0:
        return b""

    stereo = array.array("h")
    stereo.frombytes(pcm16_bytes[:usable_len])
    mono = array.array("h")
    for idx in range(0, len(stereo), 2):
        mixed = stereo[idx] + stereo[idx + 1]
        if mixed > 32767:
            mixed = 32767
        elif mixed < -32768:
            mixed = -32768
        mono.append(mixed)
    return mono.tobytes()


@dataclass(frozen=True)
class AudioGateConfig:
    """STT 非依存の音量・VAD・1ch 合成ゲート設定。"""

    sample_rate: int = 16000
    input_channels: int = 2
    output_channels: int = 1
    vad_enabled: bool = True
    rms_threshold: float = 0.008
    preroll_ms: int = 300
    hangover_ms: int = 600
    max_history_seconds: float = 300.0
    capture_utterances: bool = False


@dataclass(frozen=True)
class _BufferedChunk:
    real_start: float
    real_end: float
    duration: float
    levels: tuple[float, float]
    out_pcm16: bytes


@dataclass(frozen=True)
class _EmittedSpan:
    stt_start: float
    stt_end: float
    real_start: float
    real_end: float
    levels: tuple[float, float]


@dataclass(frozen=True)
class ResolvedAudioInterval:
    """STT 上の区間を実会話時刻と優位チャンネルへ復元した結果。"""

    real_start_sec: float
    real_end_sec: float
    channel_levels: tuple[float, float]
    dominant_channel: Literal[0, 1] | None


@dataclass(frozen=True)
class UtteranceAudioChunk:
    """バッチ STT 向けの 1 発話単位オーディオと優位話者情報。"""

    pcm16_bytes: bytes
    real_start_sec: float
    real_end_sec: float
    channel_levels: tuple[float, float]
    dominant_channel: Literal[0, 1]


@dataclass(frozen=True)
class AudioGateResult:
    """1 PCM チャンクに対する音量判定・送信データ抽出結果。"""

    emit_pcm16: bytes
    is_speech_active: bool
    just_ended_utterance: bool
    channel_levels: tuple[float, float]
    dominant_channel: Literal[0, 1]
    completed_utterance: UtteranceAudioChunk | None = None


class AudioActivityGate:
    """Deepgram やバッチ STT に依存せず音量判定・無音カット・話者時刻復元を行う共通ゲート。"""

    def __init__(self, config: AudioGateConfig | None = None) -> None:
        self._config = config or AudioGateConfig()
        self._real_clock_sec = 0.0
        self._stt_clock_sec = 0.0
        self._active = False
        self._hangover_remaining_sec = 0.0
        self._preroll: deque[_BufferedChunk] = deque()
        self._preroll_duration_sec = 0.0
        self._spans: deque[_EmittedSpan] = deque()
        self._utterance_pcm_parts: list[bytes] = []
        self._utterance_real_start: float | None = None
        self._utterance_real_end = 0.0
        self._utterance_energy = [0.0, 0.0]
        self._utterance_duration = 0.0

    @property
    def is_speech_active(self) -> bool:
        return self._active

    @property
    def stt_clock_sec(self) -> float:
        return self._stt_clock_sec

    @property
    def real_clock_sec(self) -> float:
        return self._real_clock_sec

    def reset(self) -> None:
        """新しい収音ストリーム開始時に時刻とバッファを初期化する。"""
        self._real_clock_sec = 0.0
        self._stt_clock_sec = 0.0
        self._active = False
        self._hangover_remaining_sec = 0.0
        self._preroll.clear()
        self._preroll_duration_sec = 0.0
        self._spans.clear()
        self._reset_utterance_capture()

    def process_pcm16(self, pcm16_bytes: bytes) -> AudioGateResult:
        """PCM16 チャンクを解析し、VAD とチャンネル合成の結果を返す。"""
        in_ch = self._config.input_channels
        sample_rate = self._config.sample_rate
        if in_ch not in {1, 2} or sample_rate <= 0:
            return AudioGateResult(
                emit_pcm16=b"",
                is_speech_active=self._active,
                just_ended_utterance=False,
                channel_levels=(0.0, 0.0),
                dominant_channel=0,
            )

        frame_bytes = 2 * in_ch
        usable_len = len(pcm16_bytes) - (len(pcm16_bytes) % frame_bytes)
        if usable_len <= 0:
            return AudioGateResult(
                emit_pcm16=b"",
                is_speech_active=self._active,
                just_ended_utterance=False,
                channel_levels=(0.0, 0.0),
                dominant_channel=0,
            )

        usable_pcm = pcm16_bytes[:usable_len]
        duration = usable_len / (frame_bytes * sample_rate)
        levels = compute_pcm16_channel_rms(usable_pcm, channels=in_ch)
        dominant: Literal[0, 1] = 1 if (in_ch == 2 and levels[1] > levels[0]) else 0

        if in_ch == 2 and self._config.output_channels == 1:
            out_pcm = mix_stereo_pcm16_to_mono(usable_pcm)
        else:
            out_pcm = usable_pcm

        real_start = self._real_clock_sec
        real_end = real_start + duration
        self._real_clock_sec = real_end

        chunk = _BufferedChunk(
            real_start=real_start,
            real_end=real_end,
            duration=duration,
            levels=levels,
            out_pcm16=out_pcm,
        )

        is_loud = (not self._config.vad_enabled) or (max(levels) >= self._config.rms_threshold)
        hangover_sec = max(0.0, self._config.hangover_ms / 1000.0)

        if not self._active:
            if not is_loud:
                self._append_preroll(chunk)
                return AudioGateResult(
                    emit_pcm16=b"",
                    is_speech_active=False,
                    just_ended_utterance=False,
                    channel_levels=levels,
                    dominant_channel=dominant,
                )

            self._active = True
            self._hangover_remaining_sec = hangover_sec
            emit_parts: list[bytes] = []
            while self._preroll:
                pre = self._preroll.popleft()
                self._record_emitted_chunk(pre)
                emit_parts.append(pre.out_pcm16)
            self._preroll_duration_sec = 0.0
            self._record_emitted_chunk(chunk)
            emit_parts.append(chunk.out_pcm16)
            return AudioGateResult(
                emit_pcm16=b"".join(emit_parts),
                is_speech_active=True,
                just_ended_utterance=False,
                channel_levels=levels,
                dominant_channel=dominant,
            )

        self._record_emitted_chunk(chunk)
        if is_loud:
            self._hangover_remaining_sec = hangover_sec
            return AudioGateResult(
                emit_pcm16=chunk.out_pcm16,
                is_speech_active=True,
                just_ended_utterance=False,
                channel_levels=levels,
                dominant_channel=dominant,
            )

        self._hangover_remaining_sec -= duration
        if self._hangover_remaining_sec <= 1e-6:
            self._active = False
            self._hangover_remaining_sec = 0.0
            completed = self._finalize_utterance_capture()
            return AudioGateResult(
                emit_pcm16=chunk.out_pcm16,
                is_speech_active=False,
                just_ended_utterance=True,
                channel_levels=levels,
                dominant_channel=dominant,
                completed_utterance=completed,
            )

        return AudioGateResult(
            emit_pcm16=chunk.out_pcm16,
            is_speech_active=True,
            just_ended_utterance=False,
            channel_levels=levels,
            dominant_channel=dominant,
        )

    def resolve_stt_interval(
        self, stt_start_sec: float, stt_end_sec: float
    ) -> ResolvedAudioInterval | None:
        """STT の送信累積時刻区間を、元の実時刻と優位チャンネル情報へ復元する。"""
        if not self._spans:
            return None

        target_start = max(0.0, stt_start_sec)
        target_end = max(target_start, stt_end_sec)
        if target_end <= target_start:
            # duration=0 の場合は開始時刻を含む単一スパンから補間する
            for span in self._spans:
                if span.stt_start - 1e-6 <= target_start <= span.stt_end + 1e-6:
                    span_dur = max(1e-9, span.stt_end - span.stt_start)
                    ratio = max(0.0, min(1.0, (target_start - span.stt_start) / span_dur))
                    mapped = span.real_start + (span.real_end - span.real_start) * ratio
                    dom: Literal[0, 1] | None = None
                    if max(span.levels) > 0.0:
                        dom = (
                            1
                            if (
                                self._config.input_channels == 2 and span.levels[1] > span.levels[0]
                            )
                            else 0
                        )
                    return ResolvedAudioInterval(
                        real_start_sec=mapped,
                        real_end_sec=mapped,
                        channel_levels=span.levels,
                        dominant_channel=dom,
                    )
            return None

        coverage = 0.0
        energy_0 = 0.0
        energy_1 = 0.0
        real_start_min: float | None = None
        real_end_max: float | None = None

        for span in self._spans:
            overlap_start = max(target_start, span.stt_start)
            overlap_end = min(target_end, span.stt_end)
            overlap = overlap_end - overlap_start
            if overlap <= 0.0:
                continue

            span_stt_dur = max(1e-9, span.stt_end - span.stt_start)
            span_real_dur = span.real_end - span.real_start
            mapped_start = span.real_start + span_real_dur * (
                (overlap_start - span.stt_start) / span_stt_dur
            )
            mapped_end = span.real_start + span_real_dur * (
                (overlap_end - span.stt_start) / span_stt_dur
            )
            if real_start_min is None or mapped_start < real_start_min:
                real_start_min = mapped_start
            if real_end_max is None or mapped_end > real_end_max:
                real_end_max = mapped_end

            coverage += overlap
            energy_0 += (span.levels[0] ** 2) * overlap
            energy_1 += (span.levels[1] ** 2) * overlap

        if coverage <= 0.0 or real_start_min is None or real_end_max is None:
            return None

        rms0 = math.sqrt(energy_0 / coverage)
        rms1 = math.sqrt(energy_1 / coverage)
        dominant: Literal[0, 1] | None = None
        if max(rms0, rms1) > 0.0:
            dominant = 1 if (self._config.input_channels == 2 and rms1 > rms0) else 0

        return ResolvedAudioInterval(
            real_start_sec=real_start_min,
            real_end_sec=max(real_start_min, real_end_max),
            channel_levels=(rms0, rms1),
            dominant_channel=dominant,
        )

    def _append_preroll(self, chunk: _BufferedChunk) -> None:
        max_preroll_sec = max(0.0, self._config.preroll_ms / 1000.0)
        if max_preroll_sec <= 0.0:
            return
        self._preroll.append(chunk)
        self._preroll_duration_sec += chunk.duration
        while (
            self._preroll
            and self._preroll_duration_sec - self._preroll[0].duration >= max_preroll_sec
        ):
            dropped = self._preroll.popleft()
            self._preroll_duration_sec -= dropped.duration

    def _record_emitted_chunk(self, chunk: _BufferedChunk) -> None:
        stt_start = self._stt_clock_sec
        stt_end = stt_start + chunk.duration
        self._stt_clock_sec = stt_end
        self._spans.append(
            _EmittedSpan(
                stt_start=stt_start,
                stt_end=stt_end,
                real_start=chunk.real_start,
                real_end=chunk.real_end,
                levels=chunk.levels,
            )
        )
        cutoff = stt_end - self._config.max_history_seconds
        while self._spans and self._spans[0].stt_end < cutoff:
            self._spans.popleft()

        if self._config.capture_utterances:
            if self._utterance_real_start is None:
                self._utterance_real_start = chunk.real_start
            self._utterance_real_end = chunk.real_end
            self._utterance_pcm_parts.append(chunk.out_pcm16)
            self._utterance_energy[0] += (chunk.levels[0] ** 2) * chunk.duration
            self._utterance_energy[1] += (chunk.levels[1] ** 2) * chunk.duration
            self._utterance_duration += chunk.duration

    def _reset_utterance_capture(self) -> None:
        self._utterance_pcm_parts.clear()
        self._utterance_real_start = None
        self._utterance_real_end = 0.0
        self._utterance_energy = [0.0, 0.0]
        self._utterance_duration = 0.0

    def _finalize_utterance_capture(self) -> UtteranceAudioChunk | None:
        if not self._config.capture_utterances or self._utterance_duration <= 0.0:
            self._reset_utterance_capture()
            return None
        rms0 = math.sqrt(self._utterance_energy[0] / self._utterance_duration)
        rms1 = math.sqrt(self._utterance_energy[1] / self._utterance_duration)
        dom: Literal[0, 1] = 1 if (self._config.input_channels == 2 and rms1 > rms0) else 0
        result = UtteranceAudioChunk(
            pcm16_bytes=b"".join(self._utterance_pcm_parts),
            real_start_sec=self._utterance_real_start or 0.0,
            real_end_sec=self._utterance_real_end,
            channel_levels=(rms0, rms1),
            dominant_channel=dom,
        )
        self._reset_utterance_capture()
        return result
