import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("入力変更を文字列で通知する", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TextField aria-label="検索" value="" onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "検索" });
    await user.type(input, "悪");
    expect(onChange).toHaveBeenCalledWith("悪");
  });
});
