import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DualMicPanel } from "./DualMicPanel";

const meta = {
  title: "shared/components/DualMicPanel",
  component: DualMicPanel,
  tags: ["autodocs"],
  args: {
    title: "音声入力モニター",
    statusBadgeText: "待機中",
    statusBadgeTone: "neutral",
    mode: "dual",
    modeLabels: {
      single: "1マイク",
      dual: "2マイク（話者分離）",
    },
    onModeChange: () => {},
    devices: [
      { deviceId: "mic-a", label: "USB Microphone A" },
      { deviceId: "mic-b", label: "USB Microphone B" },
    ],
    emptyDeviceLabel: "マイクが見つかりません",
    channels: [
      {
        id: "mic1",
        label: "マイク 1（話者 A）",
        selectedDeviceId: "mic-a",
        deviceSelectLabel: "入力デバイス",
        levelLabel: "入力レベル",
        level: 0.65,
        isSpeaking: true,
        speakingLabel: "発話中",
        idleLabel: "無音",
      },
      {
        id: "mic2",
        label: "マイク 2（話者 B）",
        selectedDeviceId: "mic-b",
        deviceSelectLabel: "入力デバイス",
        levelLabel: "入力レベル",
        level: 0.08,
        isSpeaking: false,
        speakingLabel: "発話中",
        idleLabel: "無音",
      },
    ],
    onDeviceChange: () => {},
    onRefreshDevices: () => {},
    refreshDevicesLabel: "デバイス再取得",
    isCapturing: true,
    canStart: true,
    startLabel: "収音開始",
    stopLabel: "収音停止",
    onToggleCapture: () => {},
    captureStatsText: "16kHz Int16 PCM · 2ch · 120 frames",
    errorMessage: null,
  },
} satisfies Meta<typeof DualMicPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DualCapturing: Story = {};

export const SingleIdle: Story = {
  args: {
    mode: "single",
    statusBadgeText: "待機中",
    statusBadgeTone: "neutral",
    isCapturing: false,
    captureStatsText: "16kHz Int16 PCM · 1ch",
    channels: [
      {
        id: "mic1",
        label: "マイク 1（話者 A）",
        selectedDeviceId: "mic-a",
        deviceSelectLabel: "入力デバイス",
        levelLabel: "入力レベル",
        level: 0,
        isSpeaking: false,
        speakingLabel: "発話中",
        idleLabel: "無音",
      },
    ],
  },
};

export const ErrorState: Story = {
  args: {
    isCapturing: false,
    statusBadgeText: "エラー",
    statusBadgeTone: "danger",
    errorMessage: "マイクへのアクセスが拒否されました。ブラウザの権限設定を確認してください。",
  },
};
