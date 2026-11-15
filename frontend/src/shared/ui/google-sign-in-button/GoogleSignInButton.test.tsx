import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { GoogleSignInButton } from "./GoogleSignInButton";

it("キーボードから認証を開始でき、処理中は二重実行を防ぐ", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  const { rerender } = render(
    <GoogleSignInButton
      label="Google でログイン"
      logoSrc="/identity/google-g.png"
      onClick={onClick}
    />,
  );
  const button = screen.getByRole("button", { name: "Google でログイン" });
  await user.tab();
  expect(button).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(onClick).toHaveBeenCalledOnce();

  rerender(
    <GoogleSignInButton
      label="Google へ移動中..."
      logoSrc="/identity/google-g.png"
      disabled
      onClick={onClick}
    />,
  );
  const pending = screen.getByRole("button", { name: "Google へ移動中..." });
  expect(pending).toBeDisabled();
  await user.click(pending);
  expect(onClick).toHaveBeenCalledOnce();
});
