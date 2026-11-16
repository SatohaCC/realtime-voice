"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Header, type HeaderNavItem } from "@/shared/components";
import { clearBrowserAuthSession, subscribeAuthState } from "@/shared/lib/supabase/client";
import { Button } from "@/shared/ui";
import { appHeaderStyles } from "./AppHeader.styles";

export interface AppHeaderProps {
  /** サーバー側で判定した初期ログイン状態 */
  initialAuthenticated?: boolean;
}

/**
 * アプリケーション共通のトップアプリバー。
 */
export function AppHeader({ initialAuthenticated = false }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(initialAuthenticated);

  useEffect(() => {
    setIsAuthenticated(initialAuthenticated);
  }, [initialAuthenticated]);

  useEffect(() => {
    return subscribeAuthState({
      onUserChanged: (user) => {
        setIsAuthenticated(Boolean(user));
      },
      onSignedOut: () => {
        setIsAuthenticated(false);
      },
    });
  }, []);

  const navItems: HeaderNavItem[] = [
    { href: "/", label: "ホーム", isCurrent: pathname === "/" },
    { href: "/transcription", label: "文字起こし", isCurrent: pathname === "/transcription" },
    {
      href: "/search",
      label: "添付文書検索",
      isCurrent: pathname === "/search" || pathname.startsWith("/search/"),
    },
    {
      href: "/imports",
      label: "XML取り込み",
      isCurrent: pathname === "/imports" || pathname.startsWith("/imports/"),
    },
    { href: "/mechanism", label: "仕組み", isCurrent: pathname === "/mechanism" },
    {
      href: "/user",
      label: "ユーザー",
      isCurrent: pathname === "/user" || pathname.startsWith("/user/"),
    },
  ];

  const actions = isAuthenticated ? (
    <form
      action="/auth/logout"
      method="post"
      onSubmit={() => {
        void clearBrowserAuthSession();
      }}
    >
      <Button type="submit" variant="outlined" size="sm">
        ログアウト
      </Button>
    </form>
  ) : (
    <Button variant="tonal" size="sm" onClick={() => router.push("/login")}>
      ログイン
    </Button>
  );

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
      actions={actions}
      renderLink={({ item, children, ...linkProps }) => (
        <Link href={item.href} {...linkProps}>
          {children}
        </Link>
      )}
    />
  );
}
