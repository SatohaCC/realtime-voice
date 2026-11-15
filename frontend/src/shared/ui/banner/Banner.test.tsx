import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("tone に応じた適切な role と内容を描画する", () => {
    const { rerender } = render(<Banner tone="info">案内メッセージ</Banner>);
    expect(screen.getByRole("status")).toHaveTextContent("案内メッセージ");

    rerender(<Banner tone="danger">エラーメッセージ</Banner>);
    expect(screen.getByRole("alert")).toHaveTextContent("エラーメッセージ");
  });

  it("actions スロットを描画する", () => {
    render(
      <Banner tone="danger" actions={<button type="button">再試行</button>}>
        失敗しました
      </Banner>,
    );
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
