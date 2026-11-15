import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./Progress";

describe("Progress", () => {
  it("確定進捗の progressbar 属性と値を描画する", () => {
    render(<Progress label="録音進捗" value={50} showValue />);

    const bar = screen.getByRole("progressbar", { name: "録音進捗" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("インライン表示のカスタム値テキストと不確定状態に対応する", () => {
    const { rerender } = render(
      <Progress
        label="声紋登録"
        hideLabel
        value={40}
        showValue
        valueText="2/5秒"
        layout="inline"
        size="sm"
      />,
    );
    expect(screen.getByRole("progressbar", { name: "声紋登録" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(screen.getByText("2/5秒")).toBeInTheDocument();

    rerender(<Progress label="接続中" value={null} />);
    const indeterminate = screen.getByRole("progressbar", { name: "接続中" });
    expect(indeterminate).not.toHaveAttribute("aria-valuenow");
    expect(indeterminate).toHaveAttribute("data-indeterminate");
  });
});
