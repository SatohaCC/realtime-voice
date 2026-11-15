import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("aria-label と押下・無効状態を提供する", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    const { rerender } = render(
      <IconButton aria-label="発話を除外" pressed={false} onClick={onClick}>
        <span>-</span>
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "発話を除外" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton aria-label="発話を除外" pressed disabled onClick={onClick}>
        <span>-</span>
      </IconButton>,
    );
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toBeDisabled();
  });
});
