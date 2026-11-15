"use client";

import * as stylex from "@stylexjs/stylex";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { useSpeakerEnrollment } from "@/features/speaker/useSpeakerEnrollment";
import {
  type MicChannelView,
  type SoapItemBadge,
  SoapPanel,
  type SoapPanelSectionView,
  TranscriptChat,
  type TranscriptChatSegment,
  WorkspaceControlBar,
} from "@/shared/components";
import { formatSoapNoteAsText } from "@/shared/lib/conversation/soapClipboard";
import type {
  SoapLifecycleStatus,
  SoapSectionKey,
  SpeakerRole,
} from "@/shared/lib/conversation/types";
import { Badge, type BadgeProps } from "@/shared/ui";
import { realtimeTranscriptionContainerStyles as s } from "./RealtimeTranscriptionContainer.styles";
import { useRealtimeTranscription } from "./useRealtimeTranscription";

export interface TranscriptionWorkspaceViewProps {
  /** 上部コントロールバーへ渡す表示・操作 props */
  controlBar: ComponentProps<typeof WorkspaceControlBar>;
  /** 左ペインの文字起こしチャット props */
  transcriptChat: ComponentProps<typeof TranscriptChat>;
  /** 右ペインの SOAP パネル props */
  soapPanel: ComponentProps<typeof SoapPanel>;
  /** ナロー画面で選択中のタブ */
  mobilePane: "transcript" | "soap";
  /** ナロー画面タブ切替ハンドラ */
  onMobilePaneChange: (pane: "transcript" | "soap") => void;
  /** ナロータブに表示する発話件数 */
  transcriptCount: number;
  /** ナロータブに表示する SOAP 項目数 */
  soapItemCount: number;
  /** ナロータブに表示する SOAP 状態バッジの色調 */
  soapBadgeTone: NonNullable<BadgeProps["tone"]>;
}

/**
 * 2マイク文字起こしチャットと固定4欄 SOAP パネルを左右 50:50（狭い画面ではタブ切替）で配置する純粋ビュー。
 */
export function TranscriptionWorkspaceView({
  controlBar,
  transcriptChat,
  soapPanel,
  mobilePane,
  onMobilePaneChange,
  transcriptCount,
  soapItemCount,
  soapBadgeTone,
}: TranscriptionWorkspaceViewProps) {
  return (
    <div {...stylex.props(s.root)}>
      <WorkspaceControlBar {...controlBar} />

      <div role="tablist" aria-label="作業画面の切り替え" {...stylex.props(s.mobileTabsWrap)}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "transcript"}
          onClick={() => onMobilePaneChange("transcript")}
          {...stylex.props(
            s.mobileTabButton,
            mobilePane === "transcript" && s.mobileTabButtonActive,
          )}
        >
          文字起こし
          <Badge tone="neutral">{`${transcriptCount}`}</Badge>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "soap"}
          onClick={() => onMobilePaneChange("soap")}
          {...stylex.props(s.mobileTabButton, mobilePane === "soap" && s.mobileTabButtonActive)}
        >
          SOAP
          <Badge tone={soapBadgeTone}>{`${soapItemCount}`}</Badge>
        </button>
      </div>

      <div {...stylex.props(s.workspaceGrid)}>
        <div
          data-workspace-pane="transcript"
          {...stylex.props(s.paneColumn, mobilePane !== "transcript" && s.paneHiddenNarrow)}
        >
          <TranscriptChat {...transcriptChat} />
        </div>

        <div
          data-workspace-pane="soap"
          {...stylex.props(s.paneColumn, mobilePane !== "soap" && s.paneHiddenNarrow)}
        >
          <SoapPanel {...soapPanel} />
        </div>
      </div>
    </div>
  );
}

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

const STATUS_LABELS: Record<TranscriptChatSegment["status"], string> = {
  interim: "認識中",
  final: "確定",
  refined: "補正済",
};

const SOAP_STATUS_BADGE: Record<
  SoapLifecycleStatus,
  { text: string; tone: NonNullable<BadgeProps["tone"]> }
> = {
  idle: { text: "下書き", tone: "neutral" },
  pending: { text: "更新待ち", tone: "neutral" },
  updating: { text: "更新中", tone: "neutral" },
  ready: { text: "反映済み", tone: "success" },
  error: { text: "更新失敗", tone: "danger" },
  disabled: { text: "対象外（1マイク）", tone: "neutral" },
};

const SECTION_DEFINITIONS: readonly {
  key: SoapSectionKey;
  codeLabel: string;
  title: string;
  emptyLabel: string;
}[] = [
  {
    key: "S",
    codeLabel: "S",
    title: "S 主観的情報",
    emptyLabel: "会話から抽出された主観的情報はありません。",
  },
  {
    key: "O",
    codeLabel: "O",
    title: "O 客観的情報",
    emptyLabel: "会話から抽出された客観的情報はありません。",
  },
  {
    key: "A",
    codeLabel: "A",
    title: "A アセスメント",
    emptyLabel: "アセスメント項目はまだありません。",
  },
  {
    key: "P",
    codeLabel: "P",
    title: "P 計画",
    emptyLabel: "指導・計画項目はまだありません。",
  },
];

function speakerRoleLabel(role: SpeakerRole): string {
  if (role === "pharmacist") return "薬剤師";
  if (role === "patient") return "患者";
  return "話者不明";
}

/**
 * 2マイク音声取得・チャット風リアルタイム文字起こし・固定4欄 SOAP を左右 50:50 で接続する Container。
 */
export function RealtimeTranscriptionContainer() {
  const router = useRouter();
  const speaker = useSpeakerEnrollment();
  const {
    audio,
    segments,
    conversation,
    isConnecting,
    isStreaming,
    isStopping,
    error,
    toggleTranscription,
    startNewConversation,
    updateSegmentSpeaker,
    setSegmentEnabled,
    isSegmentUpdatePending,
  } = useRealtimeTranscription({
    speakerProfile: speaker.voiceprint
      ? { modelId: speaker.voiceprint.modelId, embedding: speaker.voiceprint.embedding }
      : null,
    onSpeakerProfileRejected: speaker.reportProfileRejected,
    onAuthInvalidated: () => {
      router.replace("/login?next=/transcription");
    },
  });

  const [mobilePane, setMobilePane] = useState<"transcript" | "soap">("transcript");
  const [highlightedSegmentKey, setHighlightedSegmentKey] = useState<string | null>(null);
  const [copiedSoap, setCopiedSoap] = useState(false);

  useEffect(() => {
    if (!highlightedSegmentKey) return;
    const timer = setTimeout(() => setHighlightedSegmentKey(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedSegmentKey]);

  useEffect(() => {
    if (!copiedSoap) return;
    const timer = setTimeout(() => setCopiedSoap(false), 2000);
    return () => clearTimeout(timer);
  }, [copiedSoap]);

  const handleSelectEvidence = useCallback((streamId: string, segmentId: string) => {
    setMobilePane("transcript");
    setHighlightedSegmentKey(`${streamId}:${segmentId}`);
  }, []);

  const handleCopySoap = useCallback(() => {
    const formatted = formatSoapNoteAsText(conversation.soap);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(formatted).then(() => setCopiedSoap(true));
    }
  }, [conversation.soap]);

  const mic1Channel: MicChannelView = {
    id: "mic1",
    label: audio.mode === "dual" ? "薬剤師 (P/A)" : "モノラル",
    selectedDeviceId: audio.mic1DeviceId,
    deviceSelectLabel: audio.mode === "dual" ? "薬剤師 入力デバイス" : "入力デバイス",
    levelLabel: audio.mode === "dual" ? "薬剤師 入力レベル" : "入力レベル",
    level: toDisplayLevel(audio.levels[0]),
    isSpeaking: audio.speaking[0],
    speakingLabel: "発話中",
    idleLabel: "無音",
  };

  // DOM 順と視覚順・Tab 順を一致させるため、2マイク時は左に患者、右に薬剤師を配置する
  const channels: MicChannelView[] =
    audio.mode === "dual"
      ? [
          {
            id: "mic2",
            label: "患者 (S)",
            selectedDeviceId: audio.mic2DeviceId,
            deviceSelectLabel: "患者 入力デバイス",
            levelLabel: "患者 入力レベル",
            level: toDisplayLevel(audio.levels[1]),
            isSpeaking: audio.speaking[1],
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
          mic1Channel,
        ]
      : [mic1Channel];

  const isActive = audio.isCapturing || isStreaming;
  const controlStatusBadge = error
    ? { text: "エラー", tone: "danger" as const }
    : isStopping
      ? { text: "SOAPを最終更新中...", tone: "neutral" as const }
      : isConnecting
        ? { text: "接続中...", tone: "neutral" as const }
        : isActive
          ? { text: "会話中", tone: "success" as const }
          : { text: "待機中", tone: "neutral" as const };

  const activeChannels = audio.mode === "dual" ? 2 : 1;
  const statsText = isActive
    ? `16kHz PCM · ${activeChannels}ch · ${audio.frameCount} frames`
    : `16kHz PCM · ${activeChannels}ch`;

  const chatSegments: TranscriptChatSegment[] =
    audio.mode === "dual"
      ? conversation.segments.map((segment) => ({
          streamId: segment.stream_id,
          segmentId: segment.segment_id,
          channelIndex: segment.channel_index,
          align: segment.speaker_role === "pharmacist" ? "right" : "left",
          speakerRole: segment.speaker_role === "unknown" ? "patient" : segment.speaker_role,
          roleName: speakerRoleLabel(
            segment.speaker_role === "unknown" ? "patient" : segment.speaker_role,
          ),
          timeLabel: formatTimestamp(segment.start_sec),
          text: segment.text,
          status: segment.status,
          disabled: segment.disabled,
          statusLabel: STATUS_LABELS[segment.status],
        }))
      : segments.map((segment) => ({
          streamId: "single",
          segmentId: segment.id,
          channelIndex: segment.channelIndex,
          align: "left",
          roleName: "話者",
          timeLabel: formatTimestamp(segment.startSec),
          text: segment.text,
          status: segment.status,
          disabled: segment.disabled,
          statusLabel: STATUS_LABELS[segment.status],
        }));

  const soapSections: SoapPanelSectionView[] = SECTION_DEFINITIONS.map((def) => {
    const items = conversation.soap.sections[def.key].items.map((item) => {
      const badges: SoapItemBadge[] = [];
      if (def.key === "O") {
        badges.push(
          item.verification_status === "confirmed"
            ? { label: "薬剤師確認", tone: "success" }
            : { label: "患者申告（未検証）", tone: "neutral" },
        );
      }
      if (def.key === "A") {
        if (item.origin === "plan_inference") {
          badges.push({ label: "S/O・Pからの推測案・要確認", tone: "neutral" });
        } else {
          badges.push({ label: "発言由来のアセスメント", tone: "success" });
        }
        if (item.stale_after_plan_update) {
          badges.push({ label: "P更新後は未反映", tone: "danger" });
        }
      }

      return {
        itemId: item.item_id,
        text: item.text,
        isChanged: conversation.changedItemIds.includes(item.item_id),
        badges,
        evidences: item.evidence.map((ev) => ({
          streamId: ev.stream_id,
          segmentId: ev.segment_id,
          speakerLabel: speakerRoleLabel(ev.speaker_role),
          quote: ev.quote,
        })),
      };
    });

    const emptyLabel =
      def.key === "A" && isStreaming && audio.mode === "dual"
        ? "文字起こし停止時に S・O・P から推測案を自動生成します。"
        : def.emptyLabel;

    return {
      key: def.key,
      codeLabel: def.codeLabel,
      title: def.title,
      emptyLabel,
      items,
    };
  });

  const effectiveSoapStatus: SoapLifecycleStatus =
    audio.mode === "single" ? "disabled" : conversation.soapStatus;
  const soapBadge = SOAP_STATUS_BADGE[effectiveSoapStatus];
  const hasAnySoapItems = soapSections.some((section) => section.items.length > 0);
  const soapItemCount = soapSections.reduce((sum, sec) => sum + sec.items.length, 0);

  const infoNotice =
    audio.mode === "single"
      ? "1マイクモードは文字起こしのみ行います（薬剤師・患者の話者分離と SOAP 自動生成は 2マイクモードで利用してください）。"
      : audio.hasDuplicateDevices
        ? "患者用と薬剤師用に同じデバイスが選ばれています。別のマイクを指定するか「1マイク」へ切り替えてください。"
        : null;

  const soapBannerText =
    conversation.soapStatusMessage ??
    (isStopping && audio.mode === "dual"
      ? "最終発話を同期し、A アセスメント案の最終更新を実行しています..."
      : null);
  const soapBannerTone: "info" | "error" = effectiveSoapStatus === "error" ? "error" : "info";

  return (
    <TranscriptionWorkspaceView
      controlBar={{
        modeGroupLabel: "収音モード",
        statusBadgeText: controlStatusBadge.text,
        statusBadgeTone: controlStatusBadge.tone,
        mode: audio.mode,
        modeLabels: {
          single: "1マイク",
          dual: "2マイク（話者分離）",
        },
        onModeChange: audio.setMode,
        devices: audio.devices,
        emptyDeviceLabel: "マイクが見つかりません",
        channels,
        onDeviceChange: (channelId, deviceId) => {
          if (channelId === "mic1") {
            audio.setMic1DeviceId(deviceId);
          } else if (channelId === "mic2") {
            audio.setMic2DeviceId(deviceId);
          }
        },
        onRefreshDevices: () => {
          void audio.refreshDevices();
        },
        refreshDevicesLabel: "デバイス再取得",
        isCapturing: isActive,
        canStart: !isConnecting && !isStopping && !audio.hasDuplicateDevices,
        canChangeMode: !isActive && !isConnecting && !isStopping,
        startLabel: isStopping
          ? "SOAPを最終更新中..."
          : isConnecting
            ? "接続中..."
            : "文字起こし開始",
        stopLabel: "文字起こし停止",
        onToggleCapture: toggleTranscription,
        newConversationLabel: "新しい会話",
        canStartNewConversation: !isActive && !isConnecting && !isStopping,
        onNewConversation: startNewConversation,
        statsText,
        infoNotice,
        errorMessage: error ?? speaker.error,
      }}
      transcriptChat={{
        title: "文字起こし",
        countLabel: `${chatSegments.length} 件`,
        segments: chatSegments,
        emptyMessage:
          "「文字起こし開始」を押して話しかけると、患者（左）と薬剤師（右）の会話が表示されます。",
        scrollToBottomLabel: "↓ 新しい発話",
        highlightedSegmentKey,
        speakerOptions: [
          { value: "pharmacist", label: "薬剤師" },
          { value: "patient", label: "患者" },
        ],
        getSpeakerSelectLabel: ({ timeLabel }) => `${timeLabel} の話者を変更`,
        onChangeSegmentSpeaker:
          audio.mode === "dual" && isStreaming ? updateSegmentSpeaker : undefined,
        getSegmentToggleLabel: ({ timeLabel, text, disabled }) =>
          `${timeLabel} の発話「${text}」を${disabled ? "有効に戻す" : "無効化"}`,
        segmentActionsDisabled: isSegmentUpdatePending,
        onSetSegmentEnabled: !isConnecting && !isStopping ? setSegmentEnabled : undefined,
      }}
      soapPanel={{
        title: "SOAP",
        statusBadgeText: soapBadge.text,
        statusBadgeTone: soapBadge.tone,
        unappliedBadgeText:
          conversation.hasUnappliedTranscript && audio.mode === "dual" ? "未反映の会話あり" : null,
        statusBannerText: soapBannerText,
        statusBannerTone: soapBannerTone,
        copyLabel: copiedSoap ? "コピーしました" : "SOAP をコピー",
        canCopy: hasAnySoapItems,
        onCopy: handleCopySoap,
        sections: soapSections,
        singleEvidencePrefix: "根拠",
        multipleEvidenceLabel: (count) => `根拠 (${count}件)`,
        onSelectEvidence: handleSelectEvidence,
      }}
      mobilePane={mobilePane}
      onMobilePaneChange={setMobilePane}
      transcriptCount={chatSegments.length}
      soapItemCount={soapItemCount}
      soapBadgeTone={soapBadge.tone}
    />
  );
}
