import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { PackageInsertImportPanel } from "./PackageInsertImportPanel";

const meta = {
  title: "Shared/Components/PackageInsertImportPanel",
  component: PackageInsertImportPanel,
  args: {
    selectedFileName: "sample-insert.xml",
    selectedFileSize: 124_000,
    onSelectFile: fn(),
    onSubmit: fn(),
    isSubmitting: false,
    result: {
      document_id: "123456_0001",
      source_sha256: "a".repeat(64),
      status: "active",
      reused: false,
      section_count: 18,
      search_unit_count: 14,
      products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
      revisions: [{ source_label: "今回", year_month: "2026-10", version: "2" }],
      generation_id: "gen-001",
      registration_sequence: 2,
      active_yj_codes: ["1111111F1011"],
      deleted_version_ids: [],
      cleanup_pending: [],
      artifacts_deleted: false,
    },
    historyPage: {
      items: [
        {
          document_id: "123456_0001",
          source_sha256: "a".repeat(64),
          filename: "sample-insert.xml",
          registration_sequence: 2,
          revised_at: "2026-10",
          products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
          active_yj_codes: ["1111111F1011"],
          artifacts_deleted: false,
        },
        {
          document_id: "123456_0001",
          source_sha256: "b".repeat(64),
          filename: "old-insert.xml",
          registration_sequence: 1,
          revised_at: "2025-04",
          products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
          active_yj_codes: [],
          artifacts_deleted: true,
        },
      ],
      total_count: 2,
      limit: 20,
      offset: 0,
    },
    historyLoading: false,
    onRefreshHistory: fn(),
    onChangeHistoryOffset: fn(),
  },
} satisfies Meta<typeof PackageInsertImportPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyHistory: Story = {
  args: {
    selectedFileName: null,
    selectedFileSize: null,
    result: null,
    historyPage: {
      items: [],
      total_count: 0,
      limit: 20,
      offset: 0,
    },
  },
};

export const SubmitError: Story = {
  args: {
    result: null,
    submitError: "同じ改訂年月の別原本が既に登録されています。",
  },
};
