import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/shared/lib/query/QueryProvider";
import { PackageInsertSearchContainer } from "./PackageInsertSearchContainer";

const mocks = vi.hoisted(() => ({
  listRegisteredMedicines: vi.fn(),
  searchPackageInserts: vi.fn(),
}));

vi.mock("@/shared/lib/package-insert/client", () => ({
  listRegisteredMedicines: mocks.listRegisteredMedicines,
  searchPackageInserts: mocks.searchPackageInserts,
}));

describe("PackageInsertSearchContainer", () => {
  beforeEach(() => {
    mocks.listRegisteredMedicines.mockReset();
    mocks.searchPackageInserts.mockReset();
  });

  it("登録済み医薬品を取得してキーワード検索・類義語拡張結果を表示する", async () => {
    const user = userEvent.setup();
    mocks.listRegisteredMedicines.mockResolvedValue({
      generation_id: "gen-1",
      items: [
        {
          generic_name: "有効成分A",
          brand_names: ["テスト錠10mg"],
          yj_codes: ["1111111F1011"],
          document_ids: ["123456_0001"],
        },
      ],
    });
    mocks.searchPackageInserts.mockResolvedValue({
      query: "吐き気",
      total_count: 1,
      expanded_keywords: ["悪心", "嘔吐"],
      items: [
        {
          unit_id: "123456_0001:11.1",
          document_id: "123456_0001",
          product_name: "テスト錠10mg",
          generic_name: "有効成分A",
          product_yj_codes: ["1111111F1011"],
          document_revision: { year_month: "2026-10", version: "2" },
          section: { code: "11.1", title: "重大な副作用" },
          kind: "section",
          excerpt: "激しい悪心・嘔吐があらわれることがある。",
          columns: null,
          references: [],
          url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/123456_0001#sec11_1",
          retrieved_by: ["keyword"],
        },
      ],
    });

    render(
      <QueryProvider>
        <PackageInsertSearchContainer />
      </QueryProvider>,
    );

    const searchInput = screen.getByLabelText("検索キーワード");
    await user.type(searchInput, "吐き気");
    await user.click(screen.getByRole("checkbox", { name: /関連する表現も検索/ }));
    await user.click(screen.getByRole("button", { name: "検索" }));

    await waitFor(() => {
      expect(screen.getByText(/「吐き気」の検索結果（合計: 1件）/)).toBeInTheDocument();
    });
    expect(mocks.searchPackageInserts).toHaveBeenCalledWith("吐き気", [], true);
    expect(screen.getByRole("heading", { name: "重大な副作用" })).toBeInTheDocument();
  });
});
