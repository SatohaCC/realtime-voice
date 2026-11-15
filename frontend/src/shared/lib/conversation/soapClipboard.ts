import type { SoapItem, SoapNote, SoapSectionKey } from "./types";

const SECTION_HEADINGS: Record<SoapSectionKey, string> = {
  S: "S (主観的情報)",
  O: "O (客観的情報)",
  A: "A (評価)",
  P: "P (計画)",
};

function formatSoapItemLine(sectionKey: SoapSectionKey, item: SoapItem): string {
  const tags: string[] = [];
  if (sectionKey === "O" && item.verification_status === "reported") {
    tags.push("患者申告/未確認");
  }
  if (sectionKey === "A" && item.origin === "plan_inference") {
    tags.push("Pからの推測案・要確認");
  }
  if (item.stale_after_plan_update) {
    tags.push("P更新後は未反映");
  }
  const suffix = tags.length > 0 ? ` [${tags.join(" / ")}]` : "";
  return `・${item.text}${suffix}`;
}

/**
 * 読み取り専用の SOAP ノートをコピー用のプレーンテキストへ整形する。
 */
export function formatSoapNoteAsText(soap: SoapNote): string {
  const keys: readonly SoapSectionKey[] = ["S", "O", "A", "P"];
  return keys
    .map((key) => {
      const items = soap.sections[key].items;
      const body =
        items.length === 0
          ? "（未抽出）"
          : items.map((item) => formatSoapItemLine(key, item)).join("\n");
      return `${SECTION_HEADINGS[key]}\n${body}`;
    })
    .join("\n\n");
}
