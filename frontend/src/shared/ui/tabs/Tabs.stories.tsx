import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Tabs, type TabsProps } from "./Tabs";

const meta = {
  title: "shared/ui/Tabs",
  component: Tabs,
  args: {
    "aria-label": "表示内容",
    items: [
      { value: "overview", label: "概要", content: "概要のコンテンツです。" },
      { value: "details", label: "詳細", content: "詳細のコンテンツです。" },
      { value: "history", label: "履歴", content: "履歴のコンテンツです。" },
    ],
  },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary" } };
const icons = [
  "M3 3h18v18H3z M7 8h10 M7 12h10 M7 16h6",
  "M12 8v8 M8 12h8 M4 4h16v16H4z",
  "M4 12a8 8 0 1 0 2-5 M4 4v5h5 M12 8v5l3 2",
].map((path) => (
  <svg
    aria-hidden="true"
    key={path}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
  >
    <path d={path} />
  </svg>
));
export const WithIconsAndBadges: Story = {
  args: {
    items: meta.args.items.map((item, index) => ({
      ...item,
      icon: icons[index],
      badge:
        index === 0
          ? { count: 3, label: "未読3件" }
          : index === 2
            ? { label: "更新あり" }
            : undefined,
    })),
  },
};
export const SecondaryWithBadges: Story = {
  args: {
    variant: "secondary",
    items: meta.args.items.map((item, index) => ({
      ...item,
      badge: index === 1 ? { count: 12, label: "未読12件" } : undefined,
    })),
  },
};
export const Disabled: Story = {
  args: {
    items: [...meta.args.items.slice(0, 2), { ...meta.args.items[2], disabled: true }],
  },
};
export const ManualActivation: Story = { args: { activation: "manual" } };
export const Scrollable: Story = {
  args: {
    items: Array.from({ length: 8 }, (_, index) => ({
      value: `section-${index}`,
      label: `セクション ${index + 1}`,
      content: `セクション ${index + 1}の内容です。`,
    })),
  },
};
function ControlledTabs(args: TabsProps) {
  const [value, setValue] = useState<string | null>("overview");
  return <Tabs {...args} value={value} onValueChange={setValue} />;
}
export const Controlled: Story = { render: (args) => <ControlledTabs {...args} /> };
