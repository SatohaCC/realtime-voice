import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { FileTrigger } from "./FileTrigger";

const meta = {
  title: "Shared/UI/FileTrigger",
  component: FileTrigger,
  args: {
    label: "XMLファイルを選択",
    accept: ".xml,application/xml,text/xml",
    onSelectFile: fn(),
  },
} satisfies Meta<typeof FileTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
