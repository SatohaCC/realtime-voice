import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SpeakerEnrollmentBar } from "./SpeakerEnrollmentBar";

const meta: Meta<typeof SpeakerEnrollmentBar> = {
  title: "Shared/Components/SpeakerEnrollmentBar",
  component: SpeakerEnrollmentBar,
  args: {
    title: "アカウント声紋",
    actionLabel: "4秒で声紋登録",
    cancelLabel: "中止",
    clearLabel: "削除",
    onEnroll: () => {},
    onCancel: () => {},
    onClear: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SpeakerEnrollmentBar>;

export const Unregistered: Story = {
  args: {
    badgeText: "未登録",
    badgeTone: "neutral",
    descriptionText: "端末ローカルに保存すると2マイク回り込み判定が向上します。",
    isEnrolling: false,
    canEnroll: true,
    canClear: false,
  },
};

export const Registered: Story = {
  args: {
    badgeText: "登録済み（端末保存）",
    badgeTone: "success",
    descriptionText: "最終更新: 17:00（有音 3.4秒）",
    actionLabel: "声紋を再登録",
    isEnrolling: false,
    canEnroll: true,
    canClear: true,
  },
};

export const Enrolling: Story = {
  args: {
    badgeText: "録音中...",
    badgeTone: "neutral",
    descriptionText: "通常の発話音量で 3〜5 秒ほどお話しください。",
    isEnrolling: true,
    canEnroll: false,
    canClear: false,
    progressRatio: 0.6,
    progressLabel: "60%",
  },
};

export const WithError: Story = {
  args: {
    badgeText: "登録エラー",
    badgeTone: "danger",
    isEnrolling: false,
    canEnroll: true,
    canClear: false,
    errorMessage: "有効な発声時間が短すぎます。もう一度お話しください。",
  },
};
