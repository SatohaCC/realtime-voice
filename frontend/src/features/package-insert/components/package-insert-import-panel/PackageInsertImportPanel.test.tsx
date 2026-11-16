import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PackageInsertImportPanel } from "./PackageInsertImportPanel";

describe("PackageInsertImportPanel", () => {
  it("ファイル選択・登録送信・結果表示・履歴更新を操作できる", async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    const onSubmit = vi.fn();
    const onRefreshHistory = vi.fn();

    render(
      <PackageInsertImportPanel
        selectedFileName="sample.xml"
        selectedFileSize={2048}
        onSelectFile={onSelectFile}
        onSubmit={onSubmit}
        isSubmitting={false}
        result={{
          document_id: "doc1",
          source_sha256: "a".repeat(64),
          status: "active",
          reused: false,
          section_count: 10,
          search_unit_count: 8,
          products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
          revisions: [{ source_label: "今回", year_month: "2026-10", version: "1" }],
          generation_id: "gen-1",
          registration_sequence: 1,
          active_yj_codes: ["1111111F1011"],
          deleted_version_ids: [],
          cleanup_pending: [],
          artifacts_deleted: false,
        }}
        historyPage={{
          items: [
            {
              document_id: "doc1",
              source_sha256: "a".repeat(64),
              filename: "sample.xml",
              registration_sequence: 1,
              revised_at: "2026-10",
              products: [{ yj_code: "1111111F1011", brand_name: "テスト錠10mg" }],
              active_yj_codes: ["1111111F1011"],
              artifacts_deleted: false,
            },
          ],
          total_count: 1,
          limit: 20,
          offset: 0,
        }}
        historyLoading={false}
        onRefreshHistory={onRefreshHistory}
        onChangeHistoryOffset={vi.fn()}
      />,
    );

    const fileInput = screen.getByLabelText("XMLファイルを選択");
    const file = new File(["<PackIns/>"], "next.xml", { type: "application/xml" });
    await user.upload(fileInput, file);
    expect(onSelectFile).toHaveBeenCalledWith(file);

    await user.click(screen.getByRole("button", { name: "XMLを登録" }));
    expect(onSubmit).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "一覧を更新" }));
    expect(onRefreshHistory).toHaveBeenCalledOnce();

    expect(screen.getByText("登録しました（検索に適用されています）")).toBeInTheDocument();
  });
});
