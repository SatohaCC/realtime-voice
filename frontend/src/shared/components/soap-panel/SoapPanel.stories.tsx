import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SoapPanel, type SoapPanelSectionView } from "./SoapPanel";

const SAMPLE_SECTIONS: readonly SoapPanelSectionView[] = [
  {
    key: "S",
    codeLabel: "S",
    title: "S 主観的情報",
    emptyLabel: "会話から抽出された主観的情報はありません。",
    items: [
      {
        itemId: "soap-S-1",
        text: "昨日から喉の痛みと軽い咳がある。",
        isChanged: true,
        badges: [{ label: "患者発言", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-2",
            speakerLabel: "患者",
            quote: "昨日から喉が痛くて",
          },
          {
            streamId: "s1",
            segmentId: "seg-3",
            speakerLabel: "患者",
            quote: "少し咳も出ています",
          },
        ],
      },
    ],
  },
  {
    key: "O",
    codeLabel: "O",
    title: "O 客観的情報",
    emptyLabel: "会話から抽出された客観的情報はありません。",
    items: [
      {
        itemId: "soap-O-1",
        text: "今朝の体温 37.8℃",
        badges: [{ label: "患者申告（未検証）", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-2",
            speakerLabel: "患者",
            quote: "今朝の体温が37.8℃ありました",
          },
        ],
      },
    ],
  },
  {
    key: "A",
    codeLabel: "A",
    title: "A アセスメント",
    emptyLabel: "アセスメント項目はまだありません。",
    items: [
      {
        itemId: "soap-A-1",
        text: "嚥下痛を伴う上気道症状で、脱水予防と経過観察が必要と考えられる。",
        badges: [{ label: "発言由来のアセスメント", tone: "success" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-4",
            speakerLabel: "薬剤師",
            quote: "喉の症状と経過から脱水に注意が必要です",
          },
        ],
      },
      {
        itemId: "soap-A-2",
        text: "S/O・Pからのアセスメント案（要確認）: 咽頭痛と発熱（37.8℃）を踏まえ、悪化予防と安全確認のため毎食後服用・水分摂取・3日後再受診を計画したと判断",
        badges: [{ label: "S/O・Pからの推測案・要確認", tone: "neutral" }],
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-5",
            speakerLabel: "薬剤師",
            quote: "毎食後1錠を服用してください",
          },
        ],
      },
    ],
  },
  {
    key: "P",
    codeLabel: "P",
    title: "P 計画",
    emptyLabel: "指導・計画項目はまだありません。",
    items: [
      {
        itemId: "soap-P-1",
        text: "毎食後に1錠服用し、水分を十分に摂取して3日改善しなければ再受診を案内。",
        evidences: [
          {
            streamId: "s1",
            segmentId: "seg-5",
            speakerLabel: "薬剤師",
            quote: "毎食後1錠を服用してください",
          },
        ],
      },
    ],
  },
];

const meta = {
  title: "shared/components/SoapPanel",
  component: SoapPanel,
  tags: ["autodocs"],
  args: {
    title: "SOAP",
    statusBadgeText: "下書き",
    statusBadgeTone: "neutral",
    copyLabel: "SOAP をコピー",
    canCopy: true,
    onCopy: () => {},
    sections: SAMPLE_SECTIONS,
    singleEvidencePrefix: "根拠",
    multipleEvidenceLabel: (count) => `根拠 (${count}件)`,
    onSelectEvidence: () => {},
  },
} satisfies Meta<typeof SoapPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptySections: Story = {
  args: {
    canCopy: false,
    sections: SAMPLE_SECTIONS.map((section) => ({ ...section, items: [] })),
  },
};

export const UpdatingAndUnapplied: Story = {
  args: {
    statusBadgeText: "更新中",
    statusBadgeTone: "neutral",
    unappliedBadgeText: "未反映の会話あり",
    statusBannerText: "直前の確定発話を SOAP へ反映しています。",
    statusBannerTone: "info",
  },
};

export const UpdateError: Story = {
  args: {
    statusBadgeText: "更新失敗",
    statusBadgeTone: "danger",
    unappliedBadgeText: "未反映の会話あり",
    statusBannerText:
      "LLM との通信がタイムアウトしました。文字起こしと直前の SOAP は保持されています。",
    statusBannerTone: "error",
  },
};
