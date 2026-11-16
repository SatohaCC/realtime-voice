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

  it("ヘッダーにホーム・文字起こし・添付文書検索・XML取り込み・仕組み・ユーザーの6リンクを描画し、現在地を示す", () => {
    mocks.pathname = "/mechanism";
    render(<AppHeader initialAuthenticated={false} />);

    const nav = screen.getByRole("navigation", { name: "メインナビゲーション" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((el) => el.textContent)).toEqual([
      "ホーム",
      "文字起こし",
      "添付文書検索",
      "XML取り込み",
      "仕組み",
      "ユーザー",
    ]);
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "文字起こし" })).toHaveAttribute(
      "href",
      "/transcription",
    );
    expect(screen.getByRole("link", { name: "添付文書検索" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "XML取り込み" })).toHaveAttribute("href", "/imports");
    expect(screen.getByRole("link", { name: "仕組み" })).toHaveAttribute("href", "/mechanism");
    expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute("href", "/user");
    expect(screen.getByRole("link", { name: "仕組み" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "ホーム" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument();
  });

  it("ユーザーページではユーザーリンクに現在地を示し、ログイン中でもメールアドレスを表示しない", () => {
    mocks.pathname = "/user";
    render(<AppHeader initialAuthenticated />);

    expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
