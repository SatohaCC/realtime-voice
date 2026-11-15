import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("LPの主見出し・文字起こしと仕組みへの導線を描画し、接続状態は表示しない", () => {
    render(<HomePage />);

    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "対話を止めずに、薬歴の土台をその場で。",
    );
    expect(screen.getByRole("link", { name: /文字起こしを始める/ })).toHaveAttribute(
      "href",
      "/transcription",
    );
    expect(screen.getByRole("link", { name: "仕組みを見る" })).toHaveAttribute(
      "href",
      "/mechanism",
    );
    expect(screen.getByRole("link", { name: /仕組みページで詳しく見る/ })).toHaveAttribute(
      "href",
      "/mechanism",
    );
    expect(screen.queryByText(/バックエンド接続状態/)).not.toBeInTheDocument();
  });
});
