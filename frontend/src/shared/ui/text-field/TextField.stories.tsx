import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { TextField } from "./TextField";

const meta = {
  title: "Shared/UI/TextField",
  component: TextField,
  args: {
    type: "search",
    placeholder: "キーワードを入力",
    "aria-label": "検索キーワード",
    onChange: fn(),
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: {
    value: "併用禁忌",
  },
};

export const Disabled: Story = {
  args: {
    value: "検索中",
    disabled: true,
  },
};
