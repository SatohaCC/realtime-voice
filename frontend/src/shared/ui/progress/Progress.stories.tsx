import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Progress } from "./Progress";

const meta = {
  title: "shared/ui/Progress",
  component: Progress,
  tags: ["autodocs"],
  args: {
    label: "声紋を録音中",
    value: 60,
    min: 0,
    max: 100,
    hideLabel: false,
    showValue: true,
    layout: "stacked",
    size: "md",
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InlineCompact: Story = {
  args: {
    hideLabel: true,
    layout: "inline",
    size: "sm",
    valueText: "3/5秒",
  },
};

export const Indeterminate: Story = {
  args: {
    label: "解析中",
    value: null,
    showValue: false,
  },
};
