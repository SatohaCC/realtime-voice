"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Header, type HeaderNavItem } from "@/shared/components/header/Header";
import { clearBrowserAuthSession, subscribeAuthState } from "@/shared/lib/supabase/client";
import { Button } from "@/shared/ui/button/Button";
import { appHeaderStyles } from "./AppHeader.styles";

export interface HeaderUserView {
  userId: string;
  email: string | null;
}

export interface AppHeaderProps {
  /** サーバー側で取得した初期ログインユーザー情報 */
  initialUser?: HeaderUserView | null;
}

/**
 * アプリケーション共通のトップアプリバー。
 */
export function AppHeader({ initialUser = null }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<HeaderUserView | null>(initialUser);

  useEffect(() => {
    setCurrentUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    return subscribeAuthState({
      onUserChanged: (user) => {
        setCurrentUser(user);
      },
      onSignedOut: () => {
        setCurrentUser(null);
      },
    });
  }, []);

  const navItems: HeaderNavItem[] = [
    { href: "/", label: "ホーム", isCurrent: pathname === "/" },
    { href: "/transcription", label: "文字起こし", isCurrent: pathname === "/transcription" },
    { href: "/mechanism", label: "仕組み", isCurrent: pathname === "/mechanism" },
  ];

  const actions = currentUser ? (
    <div {...stylex.props(appHeaderStyles.authActions)}>
      {currentUser.email ? (
        <span {...stylex.props(appHeaderStyles.userLabel)}>{currentUser.email}</span>
      ) : null}
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
    </div>
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
