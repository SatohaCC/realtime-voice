import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { SoapPanelSectionView } from "@/shared/components/soap-panel/SoapPanel";
import type { TranscriptChatSegment } from "@/shared/components/transcript-chat/TranscriptChat";
import {
  TranscriptionWorkspaceView,
  type TranscriptionWorkspaceViewProps,
} from "./RealtimeTranscriptionContainer";

const SAMPLE_SEGMENTS: readonly TranscriptChatSegment[] = [
  {
    streamId: "s1",
    segmentId: "seg-1",
    channelIndex: 0,
    roleName: "薬剤師",
    micLabel: "マイク1",
    timeLabel: "00:01.2",
    text: "こんにちは。本日はどのようなお薬でお困りですか？",
    status: "final",
    statusLabel: "確定",
  },
  {
    streamId: "s1",
    segmentId: "seg-2",
    channelIndex: 1,
    roleName: "患者",
    micLabel: "マイク2",
    timeLabel: "00:04.8",
    text: "昨日から喉が痛くて、今朝の体温が37.8℃ありました。長いカタカナ用語やURL風文字列 https://example.com/very-long-medication-guidance-path-without-spaces も折り返されます。",
    status: "refined",
    statusLabel: "補正済",
  },
  {
    streamId: "s1",
    segmentId: "seg-3",
    channelIndex: 0,
    roleName: "薬剤師",
    micLabel: "マイク1",
    timeLabel: "00:10.5",
    text: "毎食後に1錠ずつ服用して、3日以上熱が続く場合は受診してください。",
    status: "final",
    statusLabel: "確定",
  },
];

const SAMPLE_SECTIONS: readonly SoapPanelSectionView[] = [
  {
    key: "S",
    codeLabel: "S",
    title: "S 主観的情報",
    emptyLabel: "会話から抽出された主観的情報はありません。",
    items: [
      {
        itemId: "s-1",
        text: "昨日から喉の痛みがある。",
        isChanged: true,
        badges: [{ label: "患者発言", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-2",
            speakerLabel: "患者",
            quote: "昨日から喉が痛くて",
          },
        ],
      },
    ],
  },
  {
    key: "O",
    codeLabel: "O",
    title: "O 客観的情報",
    emptyLabel: "会話から抽出された客観的情報はありません。",
    items: [
      {
        itemId: "o-1",
        text: "今朝の体温 37.8℃",
        badges: [{ label: "患者申告（未検証）", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-2",
            speakerLabel: "患者",
            quote: "今朝の体温が37.8℃ありました",
          },
        ],
      },
    ],
  },
  {
    key: "A",
    codeLabel: "A",
    title: "A 評価",
    emptyLabel: "評価項目はまだありません。",
    items: [
      {
        itemId: "a-1",
        text: "発熱・咽頭痛に対する服薬指導と受診勧奨基準の共有が必要。",
        badges: [{ label: "Pからの推測案・要確認", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-3",
            speakerLabel: "薬剤師",
            quote: "3日以上熱が続く場合は受診してください",
          },
        ],
      },
    ],
  },
  {
    key: "P",
    codeLabel: "P",
    title: "P 計画",
    emptyLabel: "指導・計画項目はまだありません。",
    items: [
      {
        itemId: "p-1",
        text: "毎食後1錠の服用指導、3日以上発熱継続時は受診勧奨。",
        badges: [{ label: "薬剤師発言", tone: "success" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-3",
            speakerLabel: "薬剤師",
            quote: "毎食後に1錠ずつ服用して、3日以上熱が続く場合は受診してください。",
          },
        ],
      },
    ],
  },
];

function InteractiveWorkspaceHarness(props: Partial<TranscriptionWorkspaceViewProps>) {
  const [mobilePane, setMobilePane] = useState<"transcript" | "soap">("transcript");
  const [highlightedSegmentKey, setHighlightedSegmentKey] = useState<string | null>(null);
  const [copiedSoap, setCopiedSoap] = useState(false);

  return (
    <TranscriptionWorkspaceView
      controlBar={{
        modeGroupLabel: "収音モード",
        statusBadgeText: "会話中",
        statusBadgeTone: "success",
        mode: "dual",
        modeLabels: { single: "1マイク", dual: "2マイク（話者分離）" },
        onModeChange: () => {},
        devices: [
          { deviceId: "mic-1", label: "HyperX SoloCast" },
          { deviceId: "mic-2", label: "USB Headset Mic" },
        ],
        emptyDeviceLabel: "マイクが見つかりません",
        channels: [
          {
            id: "mic1",
            label: "マイク 1 · 薬剤師 (P/A)",
            selectedDeviceId: "mic-1",
            deviceSelectLabel: "マイク 1 入力デバイス",
            levelLabel: "マイク 1 入力レベル",
            level: 0.42,
            isSpeaking: true,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
          {
            id: "mic2",
            label: "マイク 2 · 患者 (S)",
            selectedDeviceId: "mic-2",
            deviceSelectLabel: "マイク 2 入力デバイス",
            levelLabel: "マイク 2 入力レベル",
            level: 0.1,
            isSpeaking: false,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
        ],
        onDeviceChange: () => {},
        onRefreshDevices: () => {},
        refreshDevicesLabel: "デバイス再取得",
        isCapturing: true,
        canStart: true,
        startLabel: "文字起こし開始",
        stopLabel: "文字起こし停止",
        onToggleCapture: () => {},
        newConversationLabel: "新しい会話",
        canStartNewConversation: false,
        onNewConversation: () => {},
        statsText: "16kHz PCM · 2ch · 120 frames",
        ...props.controlBar,
      }}
      transcriptChat={{
        title: "文字起こし",
        countLabel: `${SAMPLE_SEGMENTS.length} 件`,
        segments: SAMPLE_SEGMENTS,
        emptyMessage: "会話が表示されます。",
        scrollToBottomLabel: "↓ 新しい発話",
        highlightedSegmentKey,
        ...props.transcriptChat,
      }}
      soapPanel={{
        title: "SOAP",
        statusBadgeText: "反映済み",
        statusBadgeTone: "success",
        copyLabel: copiedSoap ? "コピーしました" : "SOAP をコピー",
        canCopy: true,
        onCopy: () => setCopiedSoap(true),
        sections: SAMPLE_SECTIONS,
        singleEvidencePrefix: "根拠",
        multipleEvidenceLabel: (count) => `根拠 (${count}件)`,
        onSelectEvidence: (streamId, segmentId) => {
          setMobilePane("transcript");
          setHighlightedSegmentKey(`${streamId}:${segmentId}`);
        },
        ...props.soapPanel,
      }}
      mobilePane={mobilePane}
      onMobilePaneChange={setMobilePane}
      transcriptCount={SAMPLE_SEGMENTS.length}
      soapItemCount={4}
      soapBadgeTone="success"
    />
  );
}

const meta = {
  title: "features/transcription/TranscriptionWorkspaceView",
  component: InteractiveWorkspaceHarness,
  tags: ["autodocs"],
} satisfies Meta<typeof InteractiveWorkspaceHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
