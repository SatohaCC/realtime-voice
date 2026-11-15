import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("ラジオグループとして排他選択・矢印キー移動・値変更通知を行う", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        aria-label="収音モード"
        value="dual"
        onValueChange={onValueChange}
        items={[
          { value: "dual", label: "2マイク（話者分離）" },
          { value: "single", label: "1マイク" },
        ]}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "収音モード" });
    expect(group).toBeInTheDocument();

    const dualRadio = screen.getByRole("radio", { name: "2マイク（話者分離）" });
    const singleRadio = screen.getByRole("radio", { name: "1マイク" });
    expect(dualRadio).toHaveAttribute("aria-checked", "true");
    expect(singleRadio).toHaveAttribute("aria-checked", "false");

    dualRadio.focus();
    await user.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenCalledWith("single");
  });

  it("無効時は選択状態の変更と操作を受け付けない", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        aria-label="収音モード"
        value="dual"
        disabled
        onValueChange={onValueChange}
        items={[
          { value: "dual", label: "2マイク（話者分離）" },
          { value: "single", label: "1マイク" },
        ]}
      />,
    );

    const singleRadio = screen.getByRole("radio", { name: "1マイク" });
    expect(singleRadio).toHaveAttribute("aria-disabled", "true");
    await user.click(singleRadio);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
