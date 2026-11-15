import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  TranscriptChat,
  type TranscriptChatSegment,
  type TranscriptSpeakerOption,
  type TranscriptSpeakerRole,
} from "./TranscriptChat";

const SPEAKER_OPTIONS: readonly TranscriptSpeakerOption[] = [
  { value: "pharmacist", label: "薬剤師" },
  { value: "patient", label: "患者" },
];

const SPEAKER_LABELS: Record<TranscriptSpeakerRole, string> = {
  pharmacist: "薬剤師",
  patient: "患者",
  unknown: "話者不明",
};

const INITIAL_SEGMENTS: readonly TranscriptChatSegment[] = [
  {
    streamId: "stream-1",
    segmentId: "seg-1",
    channelIndex: 0,
    align: "right",
    speakerRole: "pharmacist",
    roleName: "薬剤師",
    micLabel: "マイク1",
    timeLabel: "00:01.2",
    text: "こんにちは。本日はどのようなお薬でお困りですか？",
    status: "final",
    statusLabel: "確定",
  },
  {
    streamId: "stream-1",
    segmentId: "seg-2",
    channelIndex: 1,
    align: "left",
    speakerRole: "patient",
    roleName: "患者",
    micLabel: "マイク2",
    timeLabel: "00:05.4",
    text: "昨日から喉が痛くて、今朝の体温が37.8℃ありました。",
    status: "final",
    statusLabel: "確定",
  },
  {
    streamId: "stream-1",
    segmentId: "seg-3",
    channelIndex: 1,
    align: "left",
    speakerRole: "patient",
    roleName: "患者",
    micLabel: "マイク2",
    timeLabel: "00:09.1",
    text: "あと少し咳も出ています。",
    status: "refined",
    statusLabel: "補正済",
  },
  {
    streamId: "stream-1",
    segmentId: "seg-4",
    channelIndex: 0,
    align: "right",
    speakerRole: "pharmacist",
    roleName: "薬剤師",
    micLabel: "マイク1",
    timeLabel: "00:13.0",
    text: "毎食後に1錠ずつお水で服用して…",
    status: "interim",
    statusLabel: "認識中",
  },
];

const meta = {
  title: "shared/components/TranscriptChat",
  component: TranscriptChat,
  tags: ["autodocs"],
  args: {
    title: "文字起こし",
    countLabel: "4 発話",
    emptyMessage: "「文字起こし開始」を押すと、薬剤師・患者の会話がここに表示されます。",
    scrollToBottomLabel: "↓ 新しい発話",
    speakerOptions: SPEAKER_OPTIONS,
    getSpeakerSelectLabel: ({ timeLabel }) => `${timeLabel} の話者を変更`,
    getSegmentToggleLabel: ({ timeLabel, text, disabled }) =>
      `${timeLabel} の発話「${text}」を${disabled ? "有効に戻す" : "無効化"}`,
    segments: INITIAL_SEGMENTS,
  },
} satisfies Meta<typeof TranscriptChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSpeakerSelector: Story = {
  render: (args) => {
    const [segments, setSegments] = useState<readonly TranscriptChatSegment[]>(() => [
      INITIAL_SEGMENTS[0],
      {
        streamId: "stream-1",
        segmentId: "seg-dup",
        channelIndex: 1,
        align: "right",
        speakerRole: "pharmacist",
        roleName: "薬剤師",
        micLabel: "マイク2",
        timeLabel: "00:01.2",
        text: "こんにちは。本日はどのようなお薬でお困りですか？",
        status: "final",
        statusLabel: "確定",
      },
      INITIAL_SEGMENTS[1],
      INITIAL_SEGMENTS[2],
      {
        streamId: "stream-1",
        segmentId: "seg-u1",
        channelIndex: 1,
        align: "left",
        speakerRole: "patient",
        roleName: "患者",
        timeLabel: "00:11.8",
        text: "飲み合わせも気になっています。",
        status: "final",
        statusLabel: "確定",
      },
      INITIAL_SEGMENTS[3],
    ]);

    return (
      <TranscriptChat
        {...args}
        countLabel={`${segments.length} 発話`}
        segments={segments}
        onChangeSegmentSpeaker={(streamId, segmentId, speakerRole) => {
          setSegments((prev) =>
            prev.map((seg) =>
              seg.streamId === streamId && seg.segmentId === segmentId
                ? {
                    ...seg,
                    speakerRole,
                    roleName: SPEAKER_LABELS[speakerRole],
                    align: speakerRole === "pharmacist" ? "right" : "left",
                  }
                : seg,
            ),
          );
        }}
        onSetSegmentEnabled={(streamId, segmentId, enabled) => {
          setSegments((prev) =>
            prev.map((seg) =>
              seg.streamId === streamId && seg.segmentId === segmentId
                ? { ...seg, disabled: !enabled }
                : seg,
            ),
          );
        }}
      />
    );
  },
};

export const PatientFallbackAndRefined: Story = {
  args: {
    countLabel: "3 発話",
    segments: [
      INITIAL_SEGMENTS[0],
      {
        streamId: "stream-1",
        segmentId: "seg-unknown",
        channelIndex: 1,
        align: "left",
        speakerRole: "patient",
        roleName: "患者",
        timeLabel: "00:04.0",
        text: "はい。",
        status: "final",
        statusLabel: "確定",
      },
      INITIAL_SEGMENTS[2],
    ],
  },
};

export const Empty: Story = {
  args: {
    countLabel: "0 発話",
    segments: [],
  },
};

export const HighlightedEvidence: Story = {
  args: {
    highlightedSegmentKey: "stream-1:seg-2",
  },
};

export const DisabledEvidence: Story = {
  args: {
    segments: INITIAL_SEGMENTS.map((segment, index) => ({ ...segment, disabled: index === 1 })),
    onSetSegmentEnabled: () => {},
  },
};
