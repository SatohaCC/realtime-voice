import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PackageInsertEvidenceCard } from "./PackageInsertEvidenceCard";

describe("PackageInsertEvidenceCard", () => {
  it("セクション見出し・表・検索語ハイライト・出典リンクを描画する", () => {
    render(
      <PackageInsertEvidenceCard
        source={{
          unit_id: "doc1:10.1",
          document_id: "doc1",
          product_name: "テスト錠10mg",
          generic_name: "有効成分",
          product_yj_codes: ["1111111F1011"],
          document_revision: { year_month: "2026-10", version: "2" },
          section: { code: "10.1", title: "併用禁忌" },
          kind: "section",
          excerpt:
            "<table><tr><td>薬剤名</td><td>臨床症状</td></tr><tr><td>禁忌薬A</td><td>重篤な悪心が発現</td></tr></table>",
          url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1#sec10_1",
          retrieved_by: ["keyword"],
        }}
        highlightWords={["悪心"]}
      />,
    );

    expect(screen.getByRole("heading", { name: "併用禁忌" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("悪心").tagName).toBe("MARK");
    expect(screen.getByRole("link", { name: "PMDAの出典を開く ↗" })).toHaveAttribute(
      "href",
      "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1#sec10_1",
    );
  });

  it("通常セクションの長文は折りたたみ・展開を切り替えられる", async () => {
    const user = userEvent.setup();
    const longText = "あいうえおかきくけこ".repeat(35);

    render(
      <PackageInsertEvidenceCard
        source={{
          unit_id: "doc1:15.1",
          document_id: "doc1",
          product_name: "テスト錠10mg",
          generic_name: "有効成分",
          product_yj_codes: ["1111111F1011"],
          document_revision: { year_month: "2026-10" },
          section: { code: "15.1", title: "臨床使用に基づく情報" },
          kind: "section",
          excerpt: longText,
          url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/doc1",
        }}
      />,
    );

    const toggle = screen.getByRole("button", { name: "全文を表示" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "折りたたむ" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
