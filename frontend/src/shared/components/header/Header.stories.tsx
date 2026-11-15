import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@/shared/ui";
import { Header } from "./Header";
import { headerStoryStyles } from "./Header.stories.styles";

const meta = {
  title: "shared/components/Header",
  component: Header,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    brandName: "Realtime Voice",
    brandHref: "#top",
    brandMark: (
      <span {...stylex.props(headerStoryStyles.mark)} aria-hidden="true">
        v
      </span>
    ),
    navLabel: "メインナビゲーション",
    menuButtonLabel: "メニュー",
    navItems: [
      { href: "#overview", label: "概要", isCurrent: true },
      { href: "#connection", label: "接続状態" },
      { href: "#colors", label: "カラー" },
    ],
    actions: (
      <Button variant="tonal" size="sm">
        セッション開始
      </Button>
    ),
  },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithStickyScroll: Story = {
  render: (args) => (
    <div>
      <Header {...args} />
      <div {...stylex.props(headerStoryStyles.scrollSpacer)}>
        スクロールしてもヘッダーが上部に固定されます。
      </div>
    </div>
  ),
};

export const Minimal: Story = {
  args: {
    navItems: [],
    actions: undefined,
  },
};

export const ActionsOnly: Story = {
  args: {
    navItems: [],
    actions: (
      <>
        <Button variant="text" size="sm">
          ヘルプ
        </Button>
        <Button variant="filled" size="sm">
          開始
        </Button>
      </>
    ),
  },
};
