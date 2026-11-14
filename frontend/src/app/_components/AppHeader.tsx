"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Header, type HeaderNavItem } from "@/shared/components/header/Header";
import { Button } from "@/shared/ui/button/Button";
import { appHeaderStyles } from "./AppHeader.styles";

/**
 * アプリケーション共通のトップアプリバー。
 */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems: HeaderNavItem[] = [
    { href: "/", label: "ホーム", isCurrent: pathname === "/" },
    { href: "/#audio", label: "文字起こし" },
    { href: "/#connection", label: "接続状態" },
    { href: "/#colors", label: "カラー" },
  ];

  return (
    <Header
      brandName="Realtime Voice"
      brandHref="/"
      brandMark={
        <span {...stylex.props(appHeaderStyles.mark)} aria-hidden="true">
          v
        </span>
      }
      navLabel="メインナビゲーション"
      menuButtonLabel="メニュー"
      skipToContentHref="#main-content"
      skipToContentLabel="メインコンテンツへスキップ"
      navItems={navItems}
      actions={
        <Button variant="tonal" size="sm" onClick={() => router.push("/#connection")}>
          接続確認
        </Button>
      }
      renderLink={({ item, children, ...linkProps }) => (
        <Link href={item.href} {...linkProps}>
          {children}
        </Link>
      )}
    />
  );
}
