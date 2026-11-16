import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { PackageInsertSearchPanel } from "./PackageInsertSearchPanel";

const meta = {
  title: "Features/PackageInsert/PackageInsertSearchPanel",
  component: PackageInsertSearchPanel,
  args: {
    query: "吐き気",
    onQueryChange: fn(),
    onSearch: fn(),
    isSearching: false,
    isExpandEnabled: true,
    onExpansionChange: fn(),
    medicineOptions: [
      { id: "1111111F1011", label: "テスト錠10mg" },
      { id: "2222222F1011", label: "サンプル散" },
    ],
    selectedMedicineIds: [],
    onToggleMedicine: fn(),
    onClearMedicines: fn(),
    hasSearched: true,
    searchedQuery: "吐き気",
    expandedKeywords: ["悪心", "嘔吐"],
    totalCount: 2,
    displayedSources: [
      {
        unit_id: "doc1:11.1",
        document_id: "doc1",
        product_name: "テスト錠10mg",
        generic_name: "テスト成分",
        product_yj_codes: ["1111111F1011"],
        document_revision: { year_month: "2026-10", version: "2" },
        section: { code: "11.1", title: "重大な副作用" },
        kind: "section",
        excerpt: "激しい悪心・嘔吐があらわれることがある。",
        url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1#sec11_1",
        retrieved_by: ["keyword"],
      },
      {
        unit_id: "doc1:10.2",
        document_id: "doc1",
        product_name: "テスト錠10mg",
        generic_name: "テスト成分",
        product_yj_codes: ["1111111F1011"],
        document_revision: { year_month: "2026-10", version: "2" },
        section: { code: "10.2", title: "併用注意" },
        kind: "section",
        excerpt: "併用により嘔吐が増強するおそれがある。",
        url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1#sec10_2",
        retrieved_by: ["keyword"],
      },
    ],
    sectionGroups: [
      { code: "11.1", title: "重大な副作用", count: 1 },
      { code: "10.2", title: "併用注意", count: 1 },
    ],
    selectedSection: "all",
    onSelectSection: fn(),
    highlightWords: ["吐き気", "悪心", "嘔吐"],
  },
} satisfies Meta<typeof PackageInsertSearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyResult: Story = {
  args: {
    query: "該当なしキーワード",
    searchedQuery: "該当なしキーワード",
    expandedKeywords: [],
    totalCount: 0,
    displayedSources: [],
    sectionGroups: [],
  },
};

export const ErrorState: Story = {
  args: {
    hasSearched: false,
    totalCount: 0,
    displayedSources: [],
    sectionGroups: [],
    errorMessage: "サーバーとの通信に失敗しました。",
  },
};
