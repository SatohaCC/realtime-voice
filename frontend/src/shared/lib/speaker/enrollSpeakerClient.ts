import { createDualMicCapture } from "../audio/dualMicCapture";
import { EnrollmentSpeechMeter } from "./enrollmentSpeechMeter";

export interface EnrollSpeakerApiResponse {
  model_id: string;
  embedding_dim: number;
  embedding: number[];
  duration_sec: number;
  voiced_sec: number;
  rms_level: number;
  peak_level: number;
  quality_warnings: string[];
}

export interface EnrollPharmacistOptions {
  accessToken: string;
  micDeviceId: string;
  durationMs?: number;
  minVoicedSeconds?: number;
  sampleCount?: number;
  sampleRate?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onLevel?: (level: number) => void;
  onSample?: (index: number) => void;
  captureFactory?: typeof createDualMicCapture;
  fetchFn?: typeof fetch;
}

function concatArrayBuffers(chunks: readonly ArrayBuffer[]): Uint8Array {
  const totalBytes = chunks.reduce((sum, buf) => sum + buf.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of chunks) {
    merged.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return merged;
}

/**
 * 薬剤師マイクから数秒間のモノラル 16kHz PCM を一時収音し、Backend で声紋ベクトルを抽出する。
 * 生音声は抽出後ただちに破棄し、結果のみ返す。
 */
export async function enrollPharmacistVoice({
  accessToken,
  micDeviceId,
  durationMs = 5000,
  minVoicedSeconds = 0,
  sampleCount = 1,
  sampleRate = 16000,
  signal,
  onProgress,
  onLevel,
  onSample,
  captureFactory = createDualMicCapture,
  fetchFn = fetch,
}: EnrollPharmacistOptions): Promise<EnrollSpeakerApiResponse> {
  if (!accessToken.trim()) {
    throw new Error("声紋登録を行うにはログインが必要です。");
  }
  signal?.throwIfAborted();
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 3) {
    throw new Error("登録回数は1〜3回で指定してください。");
  }
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 1000 ||
    durationMs > 10000 ||
    sampleRate !== 16000 ||
    !Number.isFinite(minVoicedSeconds) ||
    minVoicedSeconds < 0 ||
    minVoicedSeconds > durationMs / 1000
  ) {
    throw new Error("登録音声は16kHz・最大10秒で、有効音声の目標を録音時間内に指定してください。");
  }

  const chunks: ArrayBuffer[] = [];
  const sampleFrames: number[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    signal?.throwIfAborted();
    onSample?.(sampleIndex);
    signal?.throwIfAborted();
    let captureError: Error | null = null;
    let elapsedFrames = 0;
    let voicedSeconds = 0;
    let onEnoughAudio: (() => void) | undefined;
    const speechMeter = new EnrollmentSpeechMeter();
    const targetFrames = Math.max(1, Math.round((durationMs / 1000) * sampleRate));

    const session = await captureFactory({
      mic1DeviceId: micDeviceId,
      autoGainControl: false,
      signal,
      onAudioFrame: (frame) => {
        if (frame.sampleRate !== sampleRate || frame.channels !== 1) {
          captureError = new Error("登録音声の形式が一致しません。");
          return;
        }
        const usable = Math.min(frame.pcm16.byteLength, (targetFrames - elapsedFrames) * 2);
        if (usable <= 0) return;
        const pcm16 = frame.pcm16.slice(0, usable);
        chunks.push(pcm16);
        elapsedFrames += usable / 2;
        voicedSeconds = speechMeter.append(pcm16);
        onLevel?.(frame.levels[0]);
        const takeProgress =
          minVoicedSeconds > 0 ? voicedSeconds / minVoicedSeconds : elapsedFrames / targetFrames;
        onProgress?.((sampleIndex + Math.min(1, takeProgress)) / sampleCount);
        if (minVoicedSeconds > 0 && voicedSeconds >= minVoicedSeconds) onEnoughAudio?.();
      },
      onError: (err) => {
        captureError = err;
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("登録をキャンセルしました。", "AbortError"));
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          onEnoughAudio = undefined;
          reject(new DOMException("登録をキャンセルしました。", "AbortError"));
        };
        const finish = () => {
          clearTimeout(timer);
          onEnoughAudio = undefined;
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const timer = setTimeout(finish, durationMs);
        onEnoughAudio = finish;
        signal?.addEventListener("abort", onAbort, { once: true });
        if (minVoicedSeconds > 0 && voicedSeconds >= minVoicedSeconds) finish();
      });
    } finally {
      await session.stop();
    }

    if (captureError) {
      throw captureError;
    }
    signal?.throwIfAborted();

    if (elapsedFrames < sampleRate) {
      throw new Error("収音データが不足しています。マイク設定を確認してやり直してください。");
    }
    sampleFrames.push(elapsedFrames);
  }

  const pcmPayload = concatArrayBuffers(chunks);
  chunks.length = 0;
  if (pcmPayload.byteLength < sampleRate * 2) {
    throw new Error("収音データが不足しています。マイク設定を確認してやり直してください。");
  }

  const boundaries =
    sampleCount > 1 ? sampleFrames.map((count) => `&sample_frames=${count}`).join("") : "";
  const response = await fetchFn(`/api/speakers/enroll?sample_rate=${sampleRate}${boundaries}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: new Blob([pcmPayload.buffer as ArrayBuffer], { type: "application/octet-stream" }),
    signal,
  });

  if (!response.ok) {
    let detail = `声紋抽出に失敗しました (HTTP ${response.status})。`;
    try {
      const errBody = (await response.json()) as { detail?: string };
      if (errBody.detail) {
        detail = errBody.detail;
      }
    } catch {
      // JSON でないエラー応答は既定文言を使う
    }
    throw new Error(detail);
  }

  return (await response.json()) as EnrollSpeakerApiResponse;
}
