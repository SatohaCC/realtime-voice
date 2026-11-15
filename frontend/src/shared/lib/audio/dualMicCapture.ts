export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
}

export interface AudioCaptureFrame {
  /** 16kHz インターリーブ済み Int16 PCM バッファ */
  pcm16: ArrayBuffer;
  sampleRate: number;
  channels: 1 | 2;
  /** 各チャンネルの RMS 音量 (0.0〜1.0) */
  levels: readonly [number, number];
}

export interface DualMicCaptureOptions {
  signal?: AbortSignal;
  mic1DeviceId: string;
  mic2DeviceId?: string;
  onAudioFrame: (frame: AudioCaptureFrame) => void;
  onError?: (error: Error) => void;
}

export interface DualMicCaptureSession {
  stop: () => Promise<void>;
}

const WORKLET_URL = "/worklets/dual-pcm-processor.js";

export interface CaptureDevices {
  mic1DeviceId: string;
  mic2DeviceId?: string;
}

/** 未選択時は権限取得後の一覧から入力を確定し、2マイクの欠落・重複を拒否する。 */
export async function resolveCaptureDevices(
  selection: CaptureDevices,
  channels: 1 | 2,
  signal?: AbortSignal,
): Promise<CaptureDevices> {
  signal?.throwIfAborted();
  if (channels === 1 || (selection.mic1DeviceId && selection.mic2DeviceId)) {
    if (channels === 2 && selection.mic1DeviceId === selection.mic2DeviceId) {
      throw new Error("2マイクモードでは異なる入力デバイスを選択してください。");
    }
    return {
      mic1DeviceId: selection.mic1DeviceId,
      mic2DeviceId: channels === 2 ? selection.mic2DeviceId : undefined,
    };
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  try {
    signal?.throwIfAborted();
    const devices = await listAudioInputDevices();
    signal?.throwIfAborted();
    const first =
      selection.mic1DeviceId ||
      devices.find((device) => device.deviceId && device.deviceId !== selection.mic2DeviceId)
        ?.deviceId;
    const second =
      selection.mic2DeviceId ||
      devices.find((device) => device.deviceId && device.deviceId !== first)?.deviceId;
    if (!first || !second || first === second) {
      throw new Error(
        "2マイクモードには異なる2つの入力デバイスが必要です。マイクを接続するか「1マイク」へ切り替えてください。",
      );
    }
    return { mic1DeviceId: first, mic2DeviceId: second };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/**
 * 利用可能な音声入力デバイス一覧を取得する。
 */
export async function listAudioInputDevices(): Promise<AudioInputDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `マイク ${index + 1}`,
    }));
}

/**
 * 1本または2本のマイクから AudioWorklet 経由で 16kHz PCM と音量レベルを連続取得する。
 */
export async function createDualMicCapture({
  mic1DeviceId,
  mic2DeviceId,
  onAudioFrame,
  onError,
  signal,
}: DualMicCaptureOptions): Promise<DualMicCaptureSession> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザはマイク入力（getUserMedia）に対応していません。");
  }

  const useDual = Boolean(mic2DeviceId);
  const channels: 1 | 2 = useDual ? 2 : 1;

  const buildConstraints = (deviceId: string): MediaTrackConstraints => ({
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    // 2マイクでは回り込んだ遠い声を自動増幅せず、マイク間の音量差を保つ
    autoGainControl: !useDual,
  });

  const streams: MediaStream[] = [];
  let audioContext: AudioContext | null = null;
  let closing: Promise<void> | undefined;
  const release = async () => {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    if (audioContext && audioContext.state !== "closed") {
      closing ??= audioContext.close();
      await closing;
    }
  };
  const abort = () => {
    void release().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    signal?.throwIfAborted();
    const stream1 = await navigator.mediaDevices.getUserMedia({
      audio: buildConstraints(mic1DeviceId),
      video: false,
    });
    streams.push(stream1);
    signal?.throwIfAborted();

    let stream2: MediaStream | null = null;
    if (useDual && mic2DeviceId) {
      stream2 = await navigator.mediaDevices.getUserMedia({
        audio: buildConstraints(mic2DeviceId),
        video: false,
      });
      streams.push(stream2);
      signal?.throwIfAborted();
    }

    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule(WORKLET_URL);
    signal?.throwIfAborted();

    const merger = audioContext.createChannelMerger(channels);
    const workletNode = new AudioWorkletNode(audioContext, "dual-pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: channels,
      channelCountMode: "explicit",
      processorOptions: { channels },
    });

    const source1 = audioContext.createMediaStreamSource(stream1);
    source1.connect(merger, 0, 0);

    if (stream2 && channels === 2) {
      const source2 = audioContext.createMediaStreamSource(stream2);
      source2.connect(merger, 0, 1);
    }

    // AudioWorkletNode は出力先へ繋がっていないと一部ブラウザで process() が動かないため、
    // ゲイン 0 のノード経由で destination に接続してハウリングを防ぐ
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    merger.connect(workletNode);
    workletNode.connect(muteGain);
    muteGain.connect(audioContext.destination);

    let flushed: (() => void) | undefined;
    let stopping: Promise<void> | undefined;
    workletNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        pcm16?: ArrayBuffer;
        sampleRate?: number;
        channels?: 1 | 2;
        levels?: [number, number];
      };
      if (data?.type === "flushed") {
        flushed?.();
        return;
      }
      if (data?.type === "audio-frame" && data.pcm16 && data.levels) {
        onAudioFrame({
          pcm16: data.pcm16,
          sampleRate: data.sampleRate ?? 16000,
          channels: data.channels ?? channels,
          levels: data.levels,
        });
      }
    };

    workletNode.onprocessorerror = () => {
      onError?.(new Error("AudioWorklet の処理中にエラーが発生しました。"));
    };

    signal?.removeEventListener("abort", abort);
    const stop = async () => {
      // 部分チャンクを受け取ってから、収音ノードとストリームを解放する。
      try {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 250);
          flushed = () => {
            clearTimeout(timer);
            resolve();
          };
          workletNode.port.postMessage({ type: "flush" });
        });
      } finally {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
        merger.disconnect();
        muteGain.disconnect();
        await release();
      }
    };
    return {
      stop: () => {
        stopping ??= stop();
        return stopping;
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", abort);
    await release();
    throw error instanceof Error ? error : new Error("マイクの初期化に失敗しました。");
  }
}

/**
 * 2チャンネルの RMS 音量からアクティブな話者チャンネルを簡易判定する。
 * 回り込み対策として、もう一方のチャンネルより一定比率以上大きい場合のみ優位とみなす。
 */
export function detectSpeakingChannels(
  levels: readonly [number, number],
  noiseFloor = 0.025,
  dominanceRatio = 1.25,
): readonly [boolean, boolean] {
  const [left, right] = levels;
  const leftSuppressed = right >= noiseFloor && right >= left * dominanceRatio;
  const rightSuppressed = left >= noiseFloor && left >= right * dominanceRatio;
  return [left >= noiseFloor && !leftSuppressed, right >= noiseFloor && !rightSuppressed];
}
