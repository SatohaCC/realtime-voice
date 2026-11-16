import { describe, expect, it } from "vitest";
import { extractHighlightWords, extractSectionGroups, formatRevision } from "./searchHelpers";
import type { PackageInsertEvidenceSource } from "./types";

describe("package-insert searchHelpers", () => {
  it("空白・全角スペース区切りの強調キーワードを重複除去して抽出する", () => {
    expect(extractHighlightWords("  悪心　嘔吐  悪心 ")).toEqual(["悪心", "嘔吐"]);
    expect(extractHighlightWords("   ")).toEqual([]);
  });

  it("検索結果の出現順を保ちながらセクション別件数を集計する", () => {
    const base: Omit<PackageInsertEvidenceSource, "unit_id" | "section"> = {
      document_id: "doc1",
      product_name: "テスト錠",
      generic_name: "有効成分",
      product_yj_codes: ["1111111F1011"],
      document_revision: { year_month: "2026-10" },
      kind: "section",
      excerpt: "本文",
      references: [],
      url: "https://example.invalid",
      retrieved_by: ["keyword"],
    };

    const groups = extractSectionGroups([
      { ...base, unit_id: "1", section: { code: "11.1", title: "重大な副作用" } },
      { ...base, unit_id: "2", section: { code: "10.1", title: "併用禁忌" } },
      { ...base, unit_id: "3", section: { code: "11.1", title: "重大な副作用" } },
    ]);

    expect(groups).toEqual([
      { code: "11.1", title: "重大な副作用", count: 2 },
      { code: "10.1", title: "併用禁忌", count: 1 },
    ]);
  });

  it("改訂情報を年月と版数表記へ整形する", () => {
    expect(formatRevision({ year_month: "2026-10", version: "2" })).toBe("2026-10 第2版");
    expect(formatRevision({ year_month: "2026-10" })).toBe("2026-10");
    expect(formatRevision({})).toBe("不明");
  });
});
