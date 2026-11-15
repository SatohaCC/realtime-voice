"""CPU のみで動作するローカル話者認識 PoC ベンチマーク・2ch 録音評価スクリプト。

本番コードを変更せず、以下を単体で実測・比較する:
1. sherpa-onnx (3D-Speaker CAM++) の CPU モデル読込時間・常駐メモリ増分・発話長別推論遅延
2. 事前登録済み薬剤師ベクトル + 会話内患者一時重心 + 2ch RMS 統合判定の動作確認
3. 実録音 2ch WAV と正解ラベルを用いた現行方式 (Baseline) との定量比較
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import math
import statistics
import sys
import time
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import sherpa_onnx  # type: ignore[import-untyped]  # sherpa-onnx に型スタブが同梱されないため

# リポジトリ内の既存正規化ロジックをそのまま参照して Baseline と比較する
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.audio_vad_service import compute_pcm16_channel_rms  # noqa: E402
from app.services.conversation_service import (  # noqa: E402
    ConversationTranscriptState,
    DeepgramTranscriptInput,
)

DEFAULT_MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)
DEFAULT_CACHE_DIR = REPO_ROOT / ".cache" / "speaker-poc"
DEFAULT_MODEL_PATH = (
    DEFAULT_CACHE_DIR / "models" / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)


class _ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def get_process_rss_mb() -> float | None:
    """現在プロセスの物理メモリ使用量 (MB) を取得する。"""
    if sys.platform == "win32":
        counters = _ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(_ProcessMemoryCounters)
        kernel32 = ctypes.windll.kernel32
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.K32GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(_ProcessMemoryCounters),
            wintypes.DWORD,
        ]
        kernel32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
        ok = kernel32.K32GetProcessMemoryInfo(
            kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
        )
        if ok:
            return counters.WorkingSetSize / (1024.0 * 1024.0)
        return None

    status_path = Path("/proc/self/status")
    if status_path.is_file():
        for line in status_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                parts = line.split()
                if len(parts) >= 2:
                    return int(parts[1]) / 1024.0
    return None


def read_wav_pcm16(path: Path) -> tuple[int, int, np.ndarray]:
    """16bit PCM WAV を読み込み、(sample_rate, channels, float32配列[frames, channels]) を返す。"""
    with wave.open(str(path), "rb") as wf:
        sample_rate = wf.getframerate()
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        if sampwidth != 2:
            raise ValueError(f"16bit PCM WAV のみ対応しています: {path} (sampwidth={sampwidth})")
        raw = wf.readframes(wf.getnframes())
    int16_arr = np.frombuffer(raw, dtype="<i2")
    reshaped = int16_arr.reshape(-1, channels if channels > 1 else 1)
    float_arr = reshaped.astype(np.float32) / 32768.0
    return sample_rate, channels, float_arr


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """L2 正規化を踏まえたコサイン類似度を算出する。"""
    norm_a = float(np.linalg.norm(vec_a))
    norm_b = float(np.linalg.norm(vec_b))
    if norm_a <= 1e-12 or norm_b <= 1e-12:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def extract_embedding(
    extractor: Any,
    samples_mono: np.ndarray,
    sample_rate: int = 16000,
) -> np.ndarray | None:
    """単一チャンネル float32 音声から話者埋め込みベクトルを抽出する。"""
    stream = extractor.create_stream()
    stream.accept_waveform(sample_rate=sample_rate, waveform=samples_mono.tolist())
    stream.input_finished()
    if not extractor.is_ready(stream):
        return None
    emb = extractor.compute(stream)
    arr = np.asarray(emb, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm > 1e-12:
        arr = arr / norm
    return arr


def ensure_sample_files(cache_dir: Path, model_path: Path) -> None:
    """PoC 用サンプル音声とモデルが未配置なら取得する。"""
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if not model_path.is_file():
        print(f"モデルをダウンロード中: {model_path.name}")
        urllib.request.urlretrieve(DEFAULT_MODEL_URL, model_path)

    samples_dir = cache_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    base = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models"
    for name in (
        "fangjun-sr-1.wav",
        "fangjun-test-sr-1.wav",
        "leijun-sr-1.wav",
        "leijun-test-sr-1.wav",
    ):
        dest = samples_dir / name
        if not dest.is_file():
            urllib.request.urlretrieve(f"{base}/{name}", dest)


def run_benchmark(model_path: Path, num_threads: int) -> None:
    """CPU のみでのモデル読込・メモリ・発話長別推論遅延・サンプル照合精度を計測する。"""
    ensure_sample_files(DEFAULT_CACHE_DIR, model_path)
    rss_before = get_process_rss_mb()

    t0 = time.perf_counter()
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(model_path),
        num_threads=num_threads,
        debug=False,
        provider="cpu",
    )
    if not config.validate():
        raise RuntimeError(f"SpeakerEmbeddingExtractorConfig の検証に失敗しました: {model_path}")
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    load_ms = (time.perf_counter() - t0) * 1000.0
    rss_after = get_process_rss_mb()

    print("=== CPU モデル計測結果 ===")
    print(f"model: {model_path.name} ({model_path.stat().st_size / (1024 * 1024):.2f} MB)")
    print(f"provider: cpu, num_threads: {num_threads}, embedding_dim: {extractor.dim}")
    print(f"model_load_ms: {load_ms:.1f} ms")
    if rss_before is not None and rss_after is not None:
        print(
            f"process_rss: {rss_before:.1f} MB -> {rss_after:.1f} MB "
            f"(+{rss_after - rss_before:.1f} MB)"
        )

    # サンプル音声で同一話者 / 別話者の類似度を確認
    samples_dir = DEFAULT_CACHE_DIR / "samples"
    embeddings: dict[str, np.ndarray] = {}
    for name in (
        "fangjun-sr-1.wav",
        "fangjun-test-sr-1.wav",
        "leijun-sr-1.wav",
        "leijun-test-sr-1.wav",
    ):
        sr, _, audio = read_wav_pcm16(samples_dir / name)
        vec = extract_embedding(extractor, audio[:, 0], sample_rate=sr)
        if vec is None:
            raise RuntimeError(f"サンプル音声が短すぎて埋め込み抽出できません: {name}")
        embeddings[name] = vec

    same_a = cosine_similarity(embeddings["fangjun-sr-1.wav"], embeddings["fangjun-test-sr-1.wav"])
    same_b = cosine_similarity(embeddings["leijun-sr-1.wav"], embeddings["leijun-test-sr-1.wav"])
    diff_ab = cosine_similarity(embeddings["fangjun-sr-1.wav"], embeddings["leijun-sr-1.wav"])
    print("\n=== サンプル話者照合（参考動作確認） ===")
    print(f"同一話者A (fangjun): {same_a:.4f}")
    print(f"同一話者B (leijun):  {same_b:.4f}")
    print(f"別話者間  (A vs B):  {diff_ab:.4f}")

    # 発話長ごとの is_ready と CPU 推論時間（10回計測）
    rng = np.random.default_rng(42)
    print("\n=== 発話長別 CPU 推論遅延 (10回平均 / p95) ===")
    for dur_sec in (0.2, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0):
        n_samples = int(16000 * dur_sec)
        synth = (0.1 * rng.standard_normal(n_samples)).astype(np.float32)
        latencies_ms: list[float] = []
        ready_ok = True
        for _ in range(10):
            s0 = time.perf_counter()
            res = extract_embedding(extractor, synth, sample_rate=16000)
            elapsed = (time.perf_counter() - s0) * 1000.0
            if res is None:
                ready_ok = False
                break
            latencies_ms.append(elapsed)
        if not ready_ok:
            print(f"  {dur_sec:4.1f}s: is_ready=False（短すぎて特徴抽出不可）")
        else:
            sorted_lat = sorted(latencies_ms)
            p95 = sorted_lat[min(len(sorted_lat) - 1, math.ceil(0.95 * len(sorted_lat)) - 1)]
            print(
                f"  {dur_sec:4.1f}s: mean={statistics.mean(latencies_ms):6.2f} ms, "
                f"p95={p95:6.2f} ms"
            )


@dataclass(frozen=True)
class EvalUtterance:
    """2ch 評価録音に対する参照セグメント（STT出力相当または正解区間）。"""

    channel_index: Literal[0, 1]
    start_sec: float
    end_sec: float
    text: str
    expected_role: Literal["pharmacist", "patient", "other", "crosstalk_drop"]
    is_short_reply: bool = False


@dataclass(frozen=True)
class SpeakerThresholds:
    """話者判定・患者一時重心更新・重複統合の閾値セット。"""

    pharmacist_high: float = 0.50
    pharmacist_low: float = 0.35
    patient_low: float = 0.35
    margin: float = 0.08
    min_embed_sec: float = 0.6
    crosstalk_text_sim: float = 0.70
    crosstalk_time_iou: float = 0.50
    rms_dominance_ratio: float = 1.8


def _char_bigram_jaccard(text_a: str, text_b: str) -> float:
    norm_a = "".join(text_a.split())
    norm_b = "".join(text_b.split())
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0
    if len(norm_a) == 1 or len(norm_b) == 1:
        return 1.0 if norm_a == norm_b else 0.0
    grams_a = {norm_a[i : i + 2] for i in range(len(norm_a) - 1)}
    grams_b = {norm_b[i : i + 2] for i in range(len(norm_b) - 1)}
    union = grams_a | grams_b
    return len(grams_a & grams_b) / len(union) if union else 0.0


def evaluate_2ch_recording(
    *,
    model_path: Path,
    enroll_pharmacist_wav: Path,
    conversation_2ch_wav: Path,
    manifest_json: Path,
    num_threads: int,
    thresholds: SpeakerThresholds,
) -> None:
    """2ch 録音とマニフェスト JSON を使い、現行方式とローカル話者照合方式を比較評価する。"""
    sr_e, ch_e, enroll_audio = read_wav_pcm16(enroll_pharmacist_wav)
    if sr_e != 16000:
        raise ValueError(f"登録音声は 16kHz を想定しています: {sr_e}")

    sr_c, ch_c, conv_audio = read_wav_pcm16(conversation_2ch_wav)
    if sr_c != 16000 or ch_c != 2:
        raise ValueError(f"会話音声は 16kHz / 2ch を想定しています: sr={sr_c}, ch={ch_c}")

    raw_items: list[dict[str, Any]] = json.loads(manifest_json.read_text(encoding="utf-8"))
    utterances = [
        EvalUtterance(
            channel_index=1 if int(item["channel_index"]) == 1 else 0,
            start_sec=float(item["start_sec"]),
            end_sec=float(item["end_sec"]),
            text=str(item["text"]),
            expected_role=item["expected_role"],
            is_short_reply=bool(item.get("is_short_reply", False)),
        )
        for item in raw_items
    ]

    # 1. 現行 Baseline 評価
    baseline_state = ConversationTranscriptState(conversation_id="eval-baseline")
    baseline_state.start_stream("s1")
    with wave.open(str(conversation_2ch_wav), "rb") as wf:
        raw_pcm = wf.readframes(wf.getnframes())
    baseline_state.append_pcm16(raw_pcm, channels=2, sample_rate=16000)

    baseline_kept: list[tuple[EvalUtterance, str]] = []
    for utt in utterances:
        outcome = baseline_state.apply_deepgram_event(
            DeepgramTranscriptInput(
                channel_index=utt.channel_index,
                text=utt.text,
                is_final=True,
                speech_final=True,
                start_sec=utt.start_sec,
                end_sec=utt.end_sec,
                confidence=0.95,
            )
        )
        if not outcome.suppressed_crosstalk and outcome.segment is not None:
            baseline_kept.append((utt, outcome.segment.speaker_role))

    # 2. Candidate（事前登録薬剤師ベクトル + 会話内患者一時重心 + 2ch RMS + 重複統合）
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(model_path), num_threads=num_threads, debug=False, provider="cpu"
    )
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)

    enroll_mono = enroll_audio[:, 0] if ch_e >= 1 else enroll_audio.reshape(-1)
    pharmacist_vec = extract_embedding(extractor, enroll_mono, sample_rate=16000)
    if pharmacist_vec is None:
        raise RuntimeError("薬剤師の登録音声から埋め込みを抽出できませんでした。")

    patient_centroid: np.ndarray | None = None
    patient_count = 0
    cand_kept: list[tuple[EvalUtterance, str]] = []
    infer_latencies_ms: list[float] = []

    raw_int16_stereo = (np.clip(conv_audio, -1.0, 1.0) * 32767.0).astype("<i2")

    for utt in sorted(utterances, key=lambda x: (x.start_sec, x.channel_index)):
        s_idx = max(0, int(utt.start_sec * 16000))
        e_idx = min(len(conv_audio), int(utt.end_sec * 16000))
        if e_idx <= s_idx:
            continue

        seg_pcm_bytes = raw_int16_stereo[s_idx:e_idx].tobytes()
        rms0, rms1 = compute_pcm16_channel_rms(seg_pcm_bytes, channels=2)
        self_rms = rms0 if utt.channel_index == 0 else rms1
        other_rms = rms1 if utt.channel_index == 0 else rms0

        dur = utt.end_sec - utt.start_sec
        t_start = time.perf_counter()
        seg_mono = conv_audio[s_idx:e_idx, utt.channel_index]
        seg_vec = (
            extract_embedding(extractor, seg_mono, sample_rate=16000)
            if dur >= thresholds.min_embed_sec
            else None
        )
        infer_latencies_ms.append((time.perf_counter() - t_start) * 1000.0)

        sim_p = cosine_similarity(seg_vec, pharmacist_vec) if seg_vec is not None else 0.0
        sim_q = (
            cosine_similarity(seg_vec, patient_centroid)
            if (seg_vec is not None and patient_centroid is not None)
            else 0.0
        )

        assigned: str = "unknown"
        if seg_vec is not None:
            if sim_p >= thresholds.pharmacist_high and (
                patient_centroid is None or sim_p - sim_q >= thresholds.margin
            ):
                assigned = "pharmacist"
            elif (
                patient_centroid is not None
                and sim_q >= thresholds.patient_low
                and sim_q - sim_p >= thresholds.margin
            ):
                assigned = "patient"
            elif (
                utt.channel_index == 1
                and sim_p < thresholds.pharmacist_low
                and self_rms >= 0.02
                and self_rms >= other_rms * thresholds.rms_dominance_ratio
            ):
                # 非薬剤師かつ患者マイク優位の高信頼区間から会話限定の患者重心を初期化/更新
                assigned = "patient"
                if dur >= 1.5:
                    if patient_centroid is None:
                        patient_centroid = seg_vec.copy()
                        patient_count = 1
                    else:
                        alpha = 0.1
                        merged = (1.0 - alpha) * patient_centroid + alpha * seg_vec
                        norm = float(np.linalg.norm(merged))
                        patient_centroid = merged / norm if norm > 1e-12 else merged
                        patient_count += 1
        else:
            # 短発話: 自マイクが明らかに優位な場合のみ暫定割当、拮抗時は unknown
            if self_rms >= 0.02 and self_rms >= other_rms * thresholds.rms_dominance_ratio:
                assigned = "pharmacist" if utt.channel_index == 0 else "patient"

        # 回り込み重複統合（直近既確定発話との時刻重畳 + 文字類似度 + 話者一致 + 音量劣位）
        is_dup = False
        if not utt.is_short_reply and other_rms > self_rms * thresholds.rms_dominance_ratio:
            for prev_utt, prev_role in cand_kept:
                if prev_utt.channel_index == utt.channel_index:
                    continue
                inter = max(
                    0.0,
                    min(prev_utt.end_sec, utt.end_sec) - max(prev_utt.start_sec, utt.start_sec),
                )
                union = max(prev_utt.end_sec, utt.end_sec) - min(prev_utt.start_sec, utt.start_sec)
                iou = inter / union if union > 0 else 0.0
                txt_sim = _char_bigram_jaccard(prev_utt.text, utt.text)
                if (
                    iou >= thresholds.crosstalk_time_iou
                    and txt_sim >= thresholds.crosstalk_text_sim
                    and assigned in (prev_role, "unknown")
                ):
                    is_dup = True
                    break
        if not is_dup:
            cand_kept.append((utt, assigned))

    def _summarize(name: str, kept: list[tuple[EvalUtterance, str]]) -> None:
        total_real = sum(1 for u in utterances if u.expected_role != "crosstalk_drop")
        total_short = sum(
            1 for u in utterances if u.is_short_reply and u.expected_role != "crosstalk_drop"
        )
        kept_real = sum(1 for u, _ in kept if u.expected_role != "crosstalk_drop")
        kept_short = sum(
            1 for u, _ in kept if u.is_short_reply and u.expected_role != "crosstalk_drop"
        )
        dup_remaining = sum(1 for u, _ in kept if u.expected_role == "crosstalk_drop")
        misassigned = sum(
            1
            for u, role in kept
            if u.expected_role in {"pharmacist", "patient"}
            and role != "unknown"
            and role != u.expected_role
        )
        unknown_cnt = sum(1 for _, role in kept if role == "unknown")
        print(f"\n--- {name} ---")
        print(f"実発話保持: {kept_real}/{total_real}")
        print(f"短発話保持: {kept_short}/{total_short}")
        print(f"回り込み残存(二重表示): {dup_remaining}")
        print(f"話者誤割り当て: {misassigned}/{kept_real}")
        print(f"保留(unknown): {unknown_cnt}")

    print("=== 2ch 実録音評価比較 ===")
    _summarize("Baseline (現行 2ch + 8文字完全一致)", baseline_kept)
    _summarize(f"Candidate (CAM++ 事前登録薬剤師 + 一時患者重心更新{patient_count}回)", cand_kept)
    if infer_latencies_ms:
        print(
            f"\nCandidate 推論遅延 mean={statistics.mean(infer_latencies_ms):.2f} ms, "
            f"max={max(infer_latencies_ms):.2f} ms"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="ローカル話者認識 PoC ベンチマーク・評価")
    sub = parser.add_subparsers(dest="cmd", required=True)

    bench = sub.add_parser("benchmark", help="CPU モデル読込・推論遅延・メモリ計測")
    bench.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    bench.add_argument("--threads", type=int, default=2)

    ev = sub.add_parser("eval", help="2ch WAV 録音で Baseline と Candidate を比較")
    ev.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    ev.add_argument("--enroll-wav", type=Path, required=True)
    ev.add_argument("--conv-wav", type=Path, required=True)
    ev.add_argument("--manifest", type=Path, required=True)
    ev.add_argument("--threads", type=int, default=2)

    args = parser.parse_args()
    if args.cmd == "benchmark":
        run_benchmark(args.model, args.threads)
        return 0
    if args.cmd == "eval":
        evaluate_2ch_recording(
            model_path=args.model,
            enroll_pharmacist_wav=args.enroll_wav,
            conversation_2ch_wav=args.conv_wav,
            manifest_json=args.manifest,
            num_threads=args.threads,
            thresholds=SpeakerThresholds(),
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
