import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TranscriptFeed } from "./TranscriptFeed";

const meta = {
  title: "shared/components/TranscriptFeed",
  component: TranscriptFeed,
  tags: ["autodocs"],
  args: {
    title: "文字起こし結果",
    countLabel: "3 件",
    emptyMessage: "収音を開始して話しかけると、ここにリアルタイムで文字起こしが表示されます。",
    clearLabel: "履歴をクリア",
    canClear: true,
    onClear: () => {},
    segments: [
      {
        id: "seg-1",
        channelIndex: 0,
        speakerLabel: "話者 A",
        text: "こんにちは。今日はどのような症状でお越しですか？",
        status: "final",
        statusLabel: "確定",
        timeLabel: "00:01.2",
      },
      {
        id: "seg-2",
        channelIndex: 1,
        speakerLabel: "話者 B",
        text: "昨日の夜から喉が痛くて、少し熱っぽい気がします。",
        status: "final",
        statusLabel: "確定",
        timeLabel: "00:05.8",
      },
      {
        id: "seg-3",
        channelIndex: 0,
        speakerLabel: "話者 A",
        text: "なるほど、いつ頃から咳も…",
        status: "interim",
        statusLabel: "仮",
        timeLabel: "00:10.4",
      },
    ],
  },
} satisfies Meta<typeof TranscriptFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    segments: [],
    canClear: false,
  },
};
