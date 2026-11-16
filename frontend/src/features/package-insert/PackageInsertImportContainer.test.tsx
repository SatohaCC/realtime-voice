import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/shared/lib/query/QueryProvider";
import { PackageInsertImportContainer } from "./PackageInsertImportContainer";

const mocks = vi.hoisted(() => ({
  listPackageInsertImports: vi.fn(),
  importPackageInsert: vi.fn(),
}));

vi.mock("@/shared/lib/package-insert/client", () => ({
  listPackageInsertImports: mocks.listPackageInsertImports,
  importPackageInsert: mocks.importPackageInsert,
}));

describe("PackageInsertImportContainer", () => {
  beforeEach(() => {
    mocks.listPackageInsertImports.mockReset();
    mocks.importPackageInsert.mockReset();
  });

  it("履歴の読み込みと XML 登録の実行・結果表示を行う", async () => {
    const user = userEvent.setup();
    mocks.listPackageInsertImports.mockResolvedValue({
      items: [],
      total_count: 0,
      limit: 20,
      offset: 0,
    });
    mocks.importPackageInsert.mockResolvedValue({
      document_id: "123456_0001",
      source_sha256: "a".repeat(64),
      status: "active",
      reused: false,
      validation_status: "valid",
      section_count: 6,
      search_unit_count: 4,
      products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
      revisions: [{ source_label: "今回", year_month: "2026-10", version: "2" }],
      warnings: [],
      transformer_version: "1.0",
      search_index_updated: true,
      generation_id: "gen-1",
      registration_sequence: 1,
      active_yj_codes: ["1111111F1011"],
      replaced_yj_codes: [],
      deleted_version_ids: [],
      cleanup_pending: [],
      artifacts_deleted: false,
    });

    render(
      <QueryProvider>
        <PackageInsertImportContainer />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/登録履歴はまだありません/)).toBeInTheDocument();
    });

    const input = screen.getByLabelText("XMLファイルを選択");
    const file = new File(["<PackIns/>"], "test.xml", { type: "application/xml" });
    await user.upload(input, file);

    await user.click(screen.getByRole("button", { name: "XMLを登録" }));

    await waitFor(() => {
      expect(screen.getByText("登録しました（検索に適用されています）")).toBeInTheDocument();
    });
    expect(mocks.importPackageInsert).toHaveBeenCalledWith(file);
  });
});
