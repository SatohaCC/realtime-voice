import { createDualMicCapture } from "../audio/dualMicCapture";

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
  sampleRate?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onLevel?: (level: number) => void;
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
  durationMs = 4000,
  sampleRate = 16000,
  signal,
  onProgress,
  onLevel,
  captureFactory = createDualMicCapture,
  fetchFn = fetch,
}: EnrollPharmacistOptions): Promise<EnrollSpeakerApiResponse> {
  if (!accessToken.trim()) {
    throw new Error("声紋登録を行うにはログインが必要です。");
  }
  signal?.throwIfAborted();

  const chunks: ArrayBuffer[] = [];
  let captureError: Error | null = null;
  let elapsedFrames = 0;
  const targetFrames = Math.max(1, Math.round((durationMs / 1000) * sampleRate));

  const session = await captureFactory({
    mic1DeviceId: micDeviceId,
    signal,
    onAudioFrame: (frame) => {
      chunks.push(frame.pcm16);
      elapsedFrames += frame.pcm16.byteLength / (2 * frame.channels);
      onLevel?.(frame.levels[0]);
      onProgress?.(Math.min(1, elapsedFrames / targetFrames));
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
        reject(new DOMException("登録をキャンセルしました。", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, durationMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  } finally {
    await session.stop();
  }

  if (captureError) {
    throw captureError;
  }
  signal?.throwIfAborted();

  const pcmPayload = concatArrayBuffers(chunks);
  chunks.length = 0;
  if (pcmPayload.byteLength < sampleRate * 2) {
    throw new Error("収音データが不足しています。マイク設定を確認してやり直してください。");
  }

  const response = await fetchFn(`/api/speakers/enroll?sample_rate=${sampleRate}`, {
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
