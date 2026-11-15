"use client";

import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import { DualMicPanel, type MicChannelView } from "@/shared/components/dual-mic-panel/DualMicPanel";
import {
  TranscriptFeed,
  type TranscriptFeedItem,
} from "@/shared/components/transcript-feed/TranscriptFeed";
import { realtimeTranscriptionContainerStyles as s } from "./RealtimeTranscriptionContainer.styles";
import { useRealtimeTranscription } from "./useRealtimeTranscription";

/**
 * 小さな会話音量でも視覚的に変化を追いやすいよう平方根スケールで補正する。
 */
function toDisplayLevel(rms: number): number {
  if (rms <= 0) return 0;
  return Math.min(1, Math.sqrt(rms) * 1.4);
}

/**
 * 秒数を `MM:SS.d` 形式の表示用ラベルへ整形する。
 */
function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
}

const STATUS_LABELS: Record<TranscriptFeedItem["status"], string> = {
  interim: "仮",
  final: "確定",
  refined: "補正済",
};

/**
 * 2マイク音声取得と Deepgram リアルタイム文字起こしフィードを接続する Container。
 */
export function RealtimeTranscriptionContainer() {
  const router = useRouter();
  const {
    audio,
    segments,
    isConnecting,
    isStreaming,
    isStopping,
    error,
    toggleTranscription,
    clearTranscripts,
  } = useRealtimeTranscription({
    onAuthInvalidated: () => {
      router.replace("/login?next=/transcription");
    },
  });

  const channels: MicChannelView[] = [
    {
      id: "mic1",
      label: audio.mode === "dual" ? "マイク 1（話者 A / L）" : "マイク 1（モノラル）",
      selectedDeviceId: audio.mic1DeviceId,
      deviceSelectLabel: "入力デバイス",
      levelLabel: "入力レベル",
      level: toDisplayLevel(audio.levels[0]),
      isSpeaking: audio.speaking[0],
      speakingLabel: "発話中",
      idleLabel: "無音",
    },
  ];

  if (audio.mode === "dual") {
    channels.push({
      id: "mic2",
      label: "マイク 2（話者 B / R）",
      selectedDeviceId: audio.mic2DeviceId,
      deviceSelectLabel: "入力デバイス",
      levelLabel: "入力レベル",
      level: toDisplayLevel(audio.levels[1]),
      isSpeaking: audio.speaking[1],
      speakingLabel: "発話中",
      idleLabel: "無音",
    });
  }

  const statusBadge = error
    ? { text: "エラー", tone: "danger" as const }
    : isStopping
      ? { text: "最終結果を受信中...", tone: "neutral" as const }
      : isConnecting
        ? { text: "接続中...", tone: "neutral" as const }
        : isStreaming && audio.isCapturing
          ? { text: "文字起こし中", tone: "success" as const }
          : { text: "待機中", tone: "neutral" as const };

  const activeChannels = audio.mode === "dual" ? 2 : 1;
  const captureStatsText =
    isStreaming && audio.isCapturing
      ? `Deepgram Nova-3 · 16kHz PCM · ${activeChannels}ch · ${audio.frameCount} frames`
      : `Deepgram Nova-3 · 16kHz PCM · ${activeChannels}ch`;

  const feedItems: TranscriptFeedItem[] = segments.map((segment) => ({
    id: segment.id,
    channelIndex: segment.channelIndex,
    speakerLabel: segment.speakerLabel,
    text: segment.text,
    status: segment.status,
    statusLabel: STATUS_LABELS[segment.status],
    timeLabel: formatTimestamp(segment.startSec),
  }));

  return (
    <div {...stylex.props(s.root)}>
      <DualMicPanel
        title="2マイク音声入力"
        statusBadgeText={statusBadge.text}
        statusBadgeTone={statusBadge.tone}
        mode={audio.mode}
        modeLabels={{
          single: "1マイク",
          dual: "2マイク（話者分離）",
        }}
        onModeChange={audio.setMode}
        devices={audio.devices}
        emptyDeviceLabel="マイクが見つかりません"
        channels={channels}
        onDeviceChange={(channelId, deviceId) => {
          if (channelId === "mic1") {
            audio.setMic1DeviceId(deviceId);
          } else if (channelId === "mic2") {
            audio.setMic2DeviceId(deviceId);
          }
        }}
        onRefreshDevices={() => {
          void audio.refreshDevices();
        }}
        refreshDevicesLabel="デバイス再取得"
        isCapturing={audio.isCapturing || isStreaming}
        canStart={!isConnecting && !isStopping}
        startLabel={
          isStopping ? "最終結果を受信中..." : isConnecting ? "接続中..." : "文字起こし開始"
        }
        stopLabel="文字起こし停止"
        onToggleCapture={toggleTranscription}
        captureStatsText={captureStatsText}
        errorMessage={error}
      />

      <hr {...stylex.props(s.divider)} />

      <TranscriptFeed
        title="リアルタイム文字起こし"
        countLabel={`${feedItems.length} 件`}
        segments={feedItems}
        emptyMessage="「文字起こし開始」を押してマイクへ話しかけると、話者別の文字起こしがここに表示されます。"
        clearLabel="履歴をクリア"
        canClear={feedItems.length > 0 && !isStreaming && !isConnecting && !isStopping}
        onClear={clearTranscripts}
      />
    </div>
  );
}
