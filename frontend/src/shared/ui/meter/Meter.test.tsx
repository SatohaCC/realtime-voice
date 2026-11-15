import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("ラベル・計測値・ARIA 属性を描画する", () => {
    render(<Meter label="マイク入力レベル" value={64} showValue />);

    const meter = screen.getByRole("meter", { name: "マイク入力レベル" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64%")).toBeInTheDocument();
  });

  it("hideLabel 時もアクセシブルな名前を保持し、明示 aria-label を優先できる", () => {
    const { rerender } = render(<Meter label="音量1" value={35} hideLabel size="sm" />);
    expect(screen.getByRole("meter", { name: "音量1" })).toHaveAttribute("aria-valuenow", "35");

    rerender(<Meter label="入力レベル" aria-label="マイク 1 入力レベル" value={82} showValue />);
    expect(screen.getByRole("meter", { name: "マイク 1 入力レベル" })).toHaveAttribute(
      "aria-valuenow",
      "82",
    );
    expect(screen.getByText("82%")).toBeInTheDocument();
  });
});
