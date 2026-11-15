import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { GoogleSignInButton } from "@/shared/ui";
import { LoginCard } from "./LoginCard";

const meta = {
  title: "Shared/Components/LoginCard",
  component: LoginCard,
  args: {
    title: "ログイン",
    description: "文字起こし機能を利用するには認証が必要です。",
    providers: [{ id: "google", label: "Google でログイン", pendingLabel: "Google へ移動中..." }],
    onSelectProvider: fn(),
    renderProviderButton: ({ provider, disabled, isPending, onClick }) => (
      <GoogleSignInButton
        label={isPending ? (provider.pendingLabel ?? provider.label) : provider.label}
        logoSrc="/identity/google-g.png"
        disabled={disabled}
        onClick={onClick}
      />
    ),
    onRetry: fn(),
    footerNote: "ログイン後、元の画面へ自動的に戻ります。",
  },
} satisfies Meta<typeof LoginCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pending: Story = {
  args: {
    pendingProviderId: "google",
  },
};

export const ErrorState: Story = {
  args: {
    errorMessage: "認証を完了できませんでした。時間をおいて再度お試しください。",
    retryLabel: "もう一度試す",
  },
};
