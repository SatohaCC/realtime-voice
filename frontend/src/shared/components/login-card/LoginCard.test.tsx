import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginCard } from "./LoginCard";

describe("LoginCard", () => {
  const providers = [
    { id: "google", label: "Google でログイン", pendingLabel: "Google へ移動中..." },
  ];

  it("プロバイダ選択と処理中状態・エラー再試行を描画する", async () => {
    const user = userEvent.setup();
    const onSelectProvider = vi.fn();
    const onRetry = vi.fn();

    const { rerender } = render(
      <LoginCard
        title="ログイン"
        description="アカウントを選択してください。"
        providers={providers}
        onSelectProvider={onSelectProvider}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Google でログイン" }));
    expect(onSelectProvider).toHaveBeenCalledWith("google");

    rerender(
      <LoginCard
        title="ログイン"
        description="アカウントを選択してください。"
        providers={providers}
        pendingProviderId="google"
        onSelectProvider={onSelectProvider}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("button", { name: "Google へ移動中..." })).toBeDisabled();

    rerender(
      <LoginCard
        title="ログイン"
        description="アカウントを選択してください。"
        providers={providers}
        errorMessage="認証に失敗しました。"
        retryLabel="再試行"
        onSelectProvider={onSelectProvider}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("認証に失敗しました。");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
