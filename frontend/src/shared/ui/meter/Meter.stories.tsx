import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Meter } from "./Meter";

const meta = {
  title: "shared/ui/Meter",
  component: Meter,
  tags: ["autodocs"],
  args: {
    label: "入力レベル",
    value: 42,
    min: 0,
    max: 100,
    hideLabel: false,
    showValue: true,
    tone: "primary",
    size: "md",
  },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ActiveTertiary: Story = {
  args: {
    value: 76,
    tone: "tertiary",
  },
};

export const CompactHiddenLabel: Story = {
  args: {
    value: 58,
    hideLabel: true,
    showValue: false,
    size: "sm",
  },
};

export const ZeroLevel: Story = {
  args: {
    value: 0,
    size: "sm",
  },
};
