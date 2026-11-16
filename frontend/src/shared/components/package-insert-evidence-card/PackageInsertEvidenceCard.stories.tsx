import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PackageInsertEvidenceCard } from "./PackageInsertEvidenceCard";

const meta = {
  title: "Shared/Components/PackageInsertEvidenceCard",
  component: PackageInsertEvidenceCard,
  args: {
    source: {
      unit_id: "123456_0001:11.1",
      document_id: "123456_0001",
      product_name: "テスト錠10mg",
      generic_name: "テスト有効成分",
      product_yj_codes: ["1111111F1011"],
      document_revision: { year_month: "2026-10", version: "2" },
      section: { code: "11.1", title: "重大な副作用" },
      kind: "section",
      excerpt:
        "### 消化器\n\n<table><tr><td>分類</td><td>頻度</td><td>副作用</td></tr><tr><td>消化器</td><td>1%未満</td><td>激しい悪心・嘔吐があらわれることがある。</td></tr></table>",
      url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/123456_0001#sec11_1",
      retrieved_by: ["keyword"],
    },
    highlightWords: ["悪心"],
  },
} satisfies Meta<typeof PackageInsertEvidenceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PriorityWarning: Story = {
  args: {
    source: {
      unit_id: "123456_0001:1",
      document_id: "123456_0001",
      product_name: "テスト錠10mg",
      generic_name: "テスト有効成分",
      product_yj_codes: ["1111111F1011"],
      document_revision: { year_month: "2026-10", version: "2" },
      section: { code: "1", title: "警告" },
      kind: "section",
      excerpt: "重篤な肝障害があらわれることがあるので、定期的に肝機能検査を行うこと。",
      url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/123456_0001#sec1",
      retrieved_by: ["keyword"],
    },
    highlightWords: ["肝障害"],
  },
};
