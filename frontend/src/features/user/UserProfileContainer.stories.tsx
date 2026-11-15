import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UserProfileView } from "./UserProfileContainer";

const meta: Meta<typeof UserProfileView> = {
  title: "features/user/UserProfileView",
  component: UserProfileView,
  tags: ["autodocs"],
  args: {
    userId: "user-pharmacist-01",
    maskedEmail: "p***@e***.com",
    devices: [
      { deviceId: "mic-1", label: "HyperX SoloCast" },
      { deviceId: "mic-2", label: "USB Headset Mic" },
    ],
    selectedMicDeviceId: "mic-1",
    onMicDeviceChange: () => {},
    onRefreshDevices: () => {},
    deviceError: null,
    deviceNotice: null,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Unregistered: Story = {
  args: {
    speakerBar: {
      title: "薬剤師声紋（端末ローカル）",
      badgeText: "未登録",
      badgeTone: "neutral",
      descriptionText:
        "薬剤師マイクに向かって3回読み上げます。各回、有効音声が約3秒分集まると次へ進みます（最大10秒）。",
      actionLabel: "3回録音して声紋登録",
      isEnrolling: false,
      canEnroll: true,
      canClear: false,
      onEnroll: () => {},
    },
  },
};

export const Enrolled: Story = {
  args: {
    speakerBar: {
      title: "薬剤師声紋（端末ローカル）",
      badgeText: "登録済み",
      badgeTone: "success",
      descriptionText: "アカウント紐づけ済み（有音 9.4 秒）",
      actionLabel: "声紋を再登録",
      clearLabel: "削除",
      isEnrolling: false,
      canEnroll: true,
      canClear: true,
      onEnroll: () => {},
      onClear: () => {},
    },
  },
};

export const Enrolling: Story = {
  args: {
    speakerBar: {
      title: "薬剤師声紋（端末ローカル）",
      badgeText: "録音中...",
      badgeTone: "neutral",
      descriptionText:
        "録音 2/3（最大10秒）：進捗が満たされるまで読み上げてください。朝と夜の食事の後に、お水で飲んでください。飲み忘れたときは薬局にご相談ください。",
      actionLabel: "3回録音して声紋登録",
      cancelLabel: "録音中止",
      isEnrolling: true,
      canEnroll: false,
      canClear: false,
      progressRatio: 0.65,
      progressLabel: "有効音声 65%",
      onEnroll: () => {},
      onCancel: () => {},
    },
  },
};
