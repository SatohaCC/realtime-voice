import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Chip } from "./Chip";

const meta = {
  title: "Shared/UI/Chip",
  component: Chip,
  args: {
    children: "併用禁忌",
    onClick: fn(),
  },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
    children: "選択中の医薬品",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
