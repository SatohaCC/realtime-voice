import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("選択状態(aria-pressed)とクリック通知を正しく扱う", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Chip selected onClick={onClick}>
        テスト薬
      </Chip>,
    );

    const chip = screen.getByRole("button", { name: "テスト薬" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
