import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Select } from "./Select";

const meta = {
  title: "shared/ui/Select",
  component: Select,
  tags: ["autodocs"],
  args: {
    label: "入力デバイス",
    placeholder: "マイクを選択",
    defaultValue: "mic-1",
    options: [
      { value: "mic-1", label: "USB Microphone (Speaker A)" },
      { value: "mic-2", label: "USB Microphone (Speaker B)" },
      { value: "mic-3", label: "Built-in Microphone (無効)", disabled: true },
    ],
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const EmptyPlaceholder: Story = {
  args: {
    defaultValue: null,
    placeholder: "デバイスが見つかりません",
    options: [],
    disabled: true,
  },
};
