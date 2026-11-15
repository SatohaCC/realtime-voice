import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "../button/Button";
import { Card } from "./Card";

const meta = {
  title: "shared/ui/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "従来M3のFilled・Outlined・Elevated Card。Filledを既定とし、カード自体は操作対象にしません。操作は内部のボタンやリンクで提供します。",
      },
    },
  },
  args: {
    variant: "filled",
    children: "関連する内容をまとめるカードです。背景色・枠線・影で区切り方を選びます。",
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};
export const Outlined: Story = { args: { variant: "outlined" } };
export const Elevated: Story = { args: { variant: "elevated" } };

export const WithActions: Story = {
  args: {
    as: "article",
    "aria-labelledby": "card-example-title",
    children: (
      <>
        <h3 id="card-example-title">カードのタイトル</h3>
        <p>長い日本語の説明文も、幅に合わせて自然に折り返します。</p>
        <Button variant="text">詳細を見る</Button>
      </>
    ),
  },
};
