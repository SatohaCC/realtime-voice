import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WorkspaceControlBar } from "./WorkspaceControlBar";

const meta = {
  title: "shared/components/WorkspaceControlBar",
  component: WorkspaceControlBar,
  tags: ["autodocs"],
  args: {
    modeGroupLabel: "収音モード",
    statusBadgeText: "待機中",
    statusBadgeTone: "neutral",
    mode: "dual",
    modeLabels: {
      single: "1マイク",
      dual: "2マイク（話者分離）",
    },
    onModeChange: () => {},
    devices: [
      { deviceId: "mic-a", label: "HyperX SoloCast" },
      { deviceId: "mic-b", label: "USB Headset Mic" },
    ],
    emptyDeviceLabel: "マイクが見つかりません",
    channels: [
      {
        id: "mic2",
        label: "患者",
        selectedDeviceId: "mic-b",
        deviceSelectLabel: "入力デバイス (患者)",
        levelLabel: "患者 入力レベル",
        level: 0,
        isSpeaking: false,
        speakingLabel: "発話中",
        idleLabel: "無音",
      },
      {
        id: "mic1",
        label: "薬剤師",
        selectedDeviceId: "mic-a",
        deviceSelectLabel: "入力デバイス (薬剤師)",
        levelLabel: "薬剤師 入力レベル",
        level: 0.3,
        isSpeaking: true,
        speakingLabel: "発話中",
        idleLabel: "無音",
      },
    ],
    onDeviceChange: () => {},
    onRefreshDevices: () => {},
    refreshDevicesLabel: "デバイス再取得",
    isCapturing: false,
    canStart: true,
    startLabel: "文字起こし開始",
    stopLabel: "文字起こし停止",
    onToggleCapture: () => {},
    newConversationLabel: "新しい会話",
    canStartNewConversation: true,
    onNewConversation: () => {},
    statsText: "Deepgram Nova-3 · 16kHz PCM · 2ch",
  },
} satisfies Meta<typeof WorkspaceControlBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Capturing: Story = {
  args: {
    statusBadgeText: "文字起こし中",
    statusBadgeTone: "success",
    isCapturing: true,
    canStartNewConversation: false,
  },
};

export const DuplicateDeviceError: Story = {
  args: {
    statusBadgeText: "エラー",
    statusBadgeTone: "danger",
    canStart: false,
    errorMessage: "薬剤師用と患者用に同じマイクデバイスは指定できません。",
  },
};
