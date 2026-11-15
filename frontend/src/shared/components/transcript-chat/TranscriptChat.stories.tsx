import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TranscriptChat } from "./TranscriptChat";

const meta = {
  title: "shared/components/TranscriptChat",
  component: TranscriptChat,
  tags: ["autodocs"],
  args: {
    title: "文字起こし",
    countLabel: "4 発話",
    emptyMessage: "「文字起こし開始」を押すと、薬剤師・患者の会話がここに表示されます。",
    scrollToBottomLabel: "↓ 新しい発話",
    segments: [
      {
        streamId: "stream-1",
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
        streamId: "stream-1",
        segmentId: "seg-2",
        channelIndex: 1,
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
        roleName: "患者",
        micLabel: "マイク2",
        timeLabel: "00:09.1",
        text: "あと少し咳も出ています。",
        status: "final",
        statusLabel: "確定",
      },
      {
        streamId: "stream-1",
        segmentId: "seg-4",
        channelIndex: 0,
        roleName: "薬剤師",
        micLabel: "マイク1",
        timeLabel: "00:13.0",
        text: "毎食後に1錠ずつお水で服用して…",
        status: "interim",
        statusLabel: "認識中",
      },
    ],
  },
} satisfies Meta<typeof TranscriptChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

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
