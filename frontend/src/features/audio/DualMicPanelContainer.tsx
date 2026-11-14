"use client";

import { DualMicPanel, type MicChannelView } from "@/shared/components/dual-mic-panel/DualMicPanel";
import { useDualMicAudio } from "./useDualMicAudio";

/**
 * 小さな会話音量でも視覚的に変化を追いやすいよう平方根スケールで補正する。
 */
function toDisplayLevel(rms: number): number {
  if (rms <= 0) return 0;
  return Math.min(1, Math.sqrt(rms) * 1.4);
}

/**
 * 2マイク音声取得 Hook と DualMicPanel を接続する Container。
 */
export function DualMicPanelContainer() {
  const {
    devices,
    mode,
    setMode,
    mic1DeviceId,
    setMic1DeviceId,
    mic2DeviceId,
    setMic2DeviceId,
    isCapturing,
    levels,
    speaking,
    frameCount,
    error,
    refreshDevices,
    toggleCapture,
  } = useDualMicAudio();

  const channels: MicChannelView[] = [
    {
      id: "mic1",
      label: mode === "dual" ? "マイク 1（話者 A / L）" : "マイク 1（モノラル）",
      selectedDeviceId: mic1DeviceId,
      deviceSelectLabel: "入力デバイス",
      levelLabel: "入力レベル",
      level: toDisplayLevel(levels[0]),
      isSpeaking: speaking[0],
      speakingLabel: "発話中",
      idleLabel: "無音",
    },
  ];

  if (mode === "dual") {
    channels.push({
      id: "mic2",
      label: "マイク 2（話者 B / R）",
      selectedDeviceId: mic2DeviceId,
      deviceSelectLabel: "入力デバイス",
      levelLabel: "入力レベル",
      level: toDisplayLevel(levels[1]),
      isSpeaking: speaking[1],
      speakingLabel: "発話中",
      idleLabel: "無音",
    });
  }

  const statusBadge = error
    ? { text: "エラー", tone: "danger" as const }
    : isCapturing
      ? { text: "収音中", tone: "success" as const }
      : { text: "待機中", tone: "neutral" as const };

  const activeChannels = mode === "dual" ? 2 : 1;
  const captureStatsText = isCapturing
    ? `16kHz Int16 PCM · ${activeChannels}ch · ${frameCount} frames`
    : `16kHz Int16 PCM · ${activeChannels}ch`;

  return (
    <DualMicPanel
      title="2マイク音声入力（Step 1）"
      statusBadgeText={statusBadge.text}
      statusBadgeTone={statusBadge.tone}
      mode={mode}
      modeLabels={{
        single: "1マイク",
        dual: "2マイク（話者分離）",
      }}
      onModeChange={setMode}
      devices={devices}
      emptyDeviceLabel="マイクが見つかりません"
      channels={channels}
      onDeviceChange={(channelId, deviceId) => {
        if (channelId === "mic1") {
          setMic1DeviceId(deviceId);
        } else if (channelId === "mic2") {
          setMic2DeviceId(deviceId);
        }
      }}
      onRefreshDevices={() => {
        void refreshDevices();
      }}
      refreshDevicesLabel="デバイス再取得"
      isCapturing={isCapturing}
      canStart={true}
      startLabel="収音開始"
      stopLabel="収音停止"
      onToggleCapture={toggleCapture}
      captureStatsText={captureStatsText}
      errorMessage={error}
    />
  );
}
