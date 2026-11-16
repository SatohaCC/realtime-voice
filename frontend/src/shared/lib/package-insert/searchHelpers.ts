import type { PackageInsertEvidenceSource } from "./types";

export interface EvidenceSectionGroup {
  code: string;
  title: string;
  count: number;
}

/**
 * 検索入力文字列と拡張語から、重複なしの強調表示用キーワード配列を抽出する。
 */
export function extractHighlightWords(queryText: string): string[] {
  const tokens = queryText
    .split(/[\s\u3000]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return Array.from(new Set(tokens));
}

/**
 * 検索結果リストから、出現順を保ったセクション別集計を生成する。
 */
export function extractSectionGroups(
  sources: readonly PackageInsertEvidenceSource[],
): EvidenceSectionGroup[] {
  const order: string[] = [];
  const groups = new Map<string, EvidenceSectionGroup>();

  for (const item of sources) {
    const code = item.section?.code || "other";
    const title = item.section?.title || "その他";
    const existing = groups.get(code);
    if (existing) {
      existing.count += 1;
    } else {
      order.push(code);
      groups.set(code, { code, title, count: 1 });
    }
  }

  return order
    .map((code) => groups.get(code))
    .filter((group): group is EvidenceSectionGroup => group !== undefined);
}

/**
 * 添付文書の改訂情報を画面表示向けの文字列に整形する。
 */
export function formatRevision(revision: {
  source_label?: string | null;
  year_month?: string | null;
  version?: string | null;
}): string {
  const ym = revision.year_month?.trim();
  const ver = revision.version?.trim();
  if (!ym && !ver) {
    return "不明";
  }
  return [ym, ver ? `第${ver}版` : ""].filter(Boolean).join(" ");
}
