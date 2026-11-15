import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MechanismPage from "./page";

describe("MechanismPage", () => {
  it("パイプライン・コアロジック・SOAP役割・仕様表を描画する", () => {
    render(<MechanismPage />);

    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "リアルタイム文字起こし・SOAP 自動生成の仕組み",
    );
    expect(screen.getAllByText(/AudioActivityGate/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/finalize_a_from_p/).length).toBeGreaterThan(0);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /文字起こし画面へ/ })).toHaveAttribute(
      "href",
      "/transcription",
    );
  });
});
