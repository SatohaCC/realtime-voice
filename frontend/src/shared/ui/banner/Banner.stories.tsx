import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "../button";
import { Banner } from "./Banner";

const meta = {
  title: "shared/ui/Banner",
  component: Banner,
  tags: ["autodocs"],
  args: {
    tone: "info",
    size: "md",
    children: "1マイクモードは文字起こしのみを行います。",
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const DangerWithAction: Story = {
  args: {
    tone: "danger",
    children: "マイクの権限が取得できませんでした。",
    actions: (
      <Button variant="outlined" size="sm">
        再試行
      </Button>
    ),
  },
};

export const Success: Story = {
  args: {
    tone: "success",
    children: "声紋の登録が完了しました。",
  },
};

export const CompactNeutral: Story = {
  args: {
    tone: "neutral",
    size: "sm",
    children: "接続待機中です。",
  },
};
