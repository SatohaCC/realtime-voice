import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/shared/ui";
import { Header } from "./Header";

describe("Header", () => {
  it("ブランド名・ナビゲーション・現在ページ・アクションを描画する", () => {
    render(
      <Header
        brandName="Realtime Voice"
        brandHref="/"
        navLabel="メインナビゲーション"
        navItems={[
          { href: "/", label: "ホーム", isCurrent: true },
          { href: "/#connection", label: "接続状態" },
        ]}
        actions={<Button type="button">セッション開始</Button>}
      />,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Realtime Voice" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "メインナビゲーション" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "接続状態" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "セッション開始" })).toBeInTheDocument();
  });

  it("メニューボタンで開閉でき、Escapeキーやリンククリックで閉じる", async () => {
    const user = userEvent.setup();

    render(
      <Header
        brandName="Realtime Voice"
        menuButtonLabel="メニュー"
        navItems={[
          { href: "#overview", label: "概要" },
          { href: "#connection", label: "接続状態" },
        ]}
      />,
    );

    const menuButton = screen.getByRole("button", { name: "メニュー" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");

    await user.tab();
    expect(screen.getByRole("link", { name: "概要" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveFocus();

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("link", { name: "概要" }));
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
  });

  it("renderLinkが指定された場合、カスタムリンクレンダラを使用する", async () => {
    const user = userEvent.setup();
    const onCustomClick = vi.fn();

    render(
      <Header
        brandName="Realtime Voice"
        brandHref="/"
        navItems={[{ href: "/settings", label: "設定", isCurrent: true }]}
        renderLink={({ item, children, onClick, ...props }) => (
          <a
            href={item.href}
            data-custom="true"
            onClick={(event) => {
              event.preventDefault();
              onCustomClick(item.href);
              onClick();
            }}
            {...props}
          >
            {children}
          </a>
        )}
      />,
    );

    const settingsLink = screen.getByRole("link", { name: "設定" });
    expect(settingsLink).toHaveAttribute("data-custom", "true");
    expect(settingsLink).toHaveAttribute("aria-current", "page");

    await user.click(settingsLink);
    expect(onCustomClick).toHaveBeenCalledWith("/settings");
  });

  it("スキップリンクが指定された場合に描画する", () => {
    render(
      <Header
        brandName="Realtime Voice"
        skipToContentHref="#main-content"
        skipToContentLabel="メインコンテンツへスキップ"
      />,
    );

    expect(screen.getByRole("link", { name: "メインコンテンツへスキップ" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });
});
