import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Shared/UI/Checkbox",
  component: Checkbox,
  args: {
    checked: false,
    onChange: fn(),
    children: "関連する表現も検索（類義語拡張）",
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: {
    checked: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
