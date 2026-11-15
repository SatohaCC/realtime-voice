import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/shared/lib/supabase/client", () => ({
  clearBrowserAuthSession: vi.fn(),
  subscribeAuthState: () => () => {},
}));

describe("AppHeader", () => {
  beforeEach(() => {
    mocks.pathname = "/";
    mocks.push.mockReset();
  });

  it("ヘッダーにホーム・文字起こし・仕組みの3リンクのみを描画し、現在地を示す", () => {
    mocks.pathname = "/mechanism";
    render(<AppHeader initialUser={null} />);

    const nav = screen.getByRole("navigation", { name: "メインナビゲーション" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((el) => el.textContent)).toEqual(["ホーム", "文字起こし", "仕組み"]);
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "文字起こし" })).toHaveAttribute(
      "href",
      "/transcription",
    );
    expect(screen.getByRole("link", { name: "仕組み" })).toHaveAttribute("href", "/mechanism");
    expect(screen.getByRole("link", { name: "仕組み" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute("aria-current");
  });
});
