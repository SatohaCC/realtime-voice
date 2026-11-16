import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("クリックでチェック状態を切り替え通知する", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Checkbox checked={false} onChange={onChange}>
        類義語拡張
      </Checkbox>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "類義語拡張" });
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
