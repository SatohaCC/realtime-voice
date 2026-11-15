import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SoapPanel, type SoapPanelSectionView } from "./SoapPanel";

const TEST_SECTIONS: readonly SoapPanelSectionView[] = [
  {
    key: "S",
    codeLabel: "S",
    title: "S 主観的情報",
    emptyLabel: "まだありません",
    items: [
      {
        itemId: "soap-S-1",
        text: "頭痛と微熱あり",
        isChanged: true,
        evidences: [
          { streamId: "s1", segmentId: "seg-1", speakerLabel: "患者", quote: "頭が痛い" },
          { streamId: "s1", segmentId: "seg-2", speakerLabel: "患者", quote: "微熱がある" },
        ],
      },
    ],
  },
  { key: "O", codeLabel: "O", title: "O 客観的情報", emptyLabel: "まだありません", items: [] },
  { key: "A", codeLabel: "A", title: "A 評価", emptyLabel: "まだありません", items: [] },
  {
    key: "P",
    codeLabel: "P",
    title: "P 計画",
    emptyLabel: "まだありません",
    items: [
      {
        itemId: "soap-P-1",
        text: "食後1錠服用を指導",
        evidences: [
          { streamId: "s1", segmentId: "seg-3", speakerLabel: "薬剤師", quote: "食後に1錠" },
        ],
      },
    ],
  },
];

describe("SoapPanel", () => {
  it("S/O/A/Pの4欄を常に描画し、空欄でも特記なし等を自動補完しない", () => {
    render(
      <SoapPanel
        title="SOAP"
        statusBadgeText="下書き"
        statusBadgeTone="neutral"
        copyLabel="コピー"
        canCopy
        onCopy={() => {}}
        sections={TEST_SECTIONS}
        singleEvidencePrefix="根拠"
        multipleEvidenceLabel={(count) => `根拠 (${count}件)`}
        onSelectEvidence={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "S 主観的情報" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "O 客観的情報" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A 評価" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "P 計画" })).toBeInTheDocument();
    expect(screen.getAllByText("まだありません")).toHaveLength(2);
    expect(screen.queryByText(/異常なし|特記なし/)).not.toBeInTheDocument();
  });

  it("単一根拠と複数根拠の一覧から発話ジャンプ通知を発火する", () => {
    const onSelectEvidence = vi.fn();
    render(
      <SoapPanel
        title="SOAP"
        statusBadgeText="反映済み"
        statusBadgeTone="success"
        copyLabel="コピー"
        canCopy
        onCopy={() => {}}
        sections={TEST_SECTIONS}
        singleEvidencePrefix="根拠"
        multipleEvidenceLabel={(count) => `根拠 (${count}件)`}
        onSelectEvidence={onSelectEvidence}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /根拠: 薬剤師「食後に1錠」/ }));
    expect(onSelectEvidence).toHaveBeenCalledWith("s1", "seg-3");

    const expandButton = screen.getByRole("button", { name: "根拠 (2件)" });
    fireEvent.click(expandButton);
    expect(expandButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "患者「微熱がある」" }));
    expect(onSelectEvidence).toHaveBeenCalledWith("s1", "seg-2");
  });
});
