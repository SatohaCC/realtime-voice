import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PackageInsertSearchPanel } from "./PackageInsertSearchPanel";

describe("PackageInsertSearchPanel", () => {
  it("検索送信・例チップ・医薬品絞り込み・セクションフィルタを操作できる", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onSearch = vi.fn();
    const onExpansionChange = vi.fn();
    const onToggleMedicine = vi.fn();
    const onSelectSection = vi.fn();

    render(
      <PackageInsertSearchPanel
        query="悪心"
        onQueryChange={onQueryChange}
        onSearch={onSearch}
        isSearching={false}
        isExpandEnabled={false}
        onExpansionChange={onExpansionChange}
        medicineOptions={[{ id: "1111111F1011", label: "テスト錠10mg" }]}
        selectedMedicineIds={[]}
        onToggleMedicine={onToggleMedicine}
        onClearMedicines={vi.fn()}
        hasSearched
        searchedQuery="悪心"
        expandedKeywords={["嘔吐"]}
        totalCount={2}
        displayedSources={[
          {
            unit_id: "doc1:11.1",
            document_id: "doc1",
            product_name: "テスト錠10mg",
            generic_name: "成分A",
            product_yj_codes: ["1111111F1011"],
            document_revision: { year_month: "2026-10" },
            section: { code: "11.1", title: "重大な副作用" },
            kind: "section",
            excerpt: "悪心・嘔吐があらわれることがある。",
            url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1",
          },
        ]}
        sectionGroups={[
          { code: "11.1", title: "重大な副作用", count: 1 },
          { code: "10.1", title: "併用禁忌", count: 1 },
        ]}
        selectedSection="all"
        onSelectSection={onSelectSection}
        highlightWords={["悪心", "嘔吐"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "検索" }));
    expect(onSearch).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "併用禁忌" }));
    expect(onQueryChange).toHaveBeenCalledWith("併用禁忌");

    await user.click(screen.getByRole("checkbox", { name: /関連する表現も検索/ }));
    expect(onExpansionChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "医薬品を選んで絞り込む" }));
    await user.click(screen.getByRole("button", { name: "テスト錠10mg" }));
    expect(onToggleMedicine).toHaveBeenCalledWith("1111111F1011");

    await user.click(screen.getByRole("button", { name: "[11.1] 重大な副作用 (1)" }));
    expect(onSelectSection).toHaveBeenCalledWith("11.1");
  });
});
