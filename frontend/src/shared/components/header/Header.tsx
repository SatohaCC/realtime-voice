"use client";

import * as stylex from "@stylexjs/stylex";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/shared/ui";
import { headerStyles } from "./Header.styles";

export interface HeaderNavItem {
  /** リンク先の URL */
  href: string;
  /** ナビゲーション項目の表示ラベル */
  label: string;
  /** 現在のページを表しているか */
  isCurrent?: boolean;
}

export interface HeaderLinkRenderParams {
  item: HeaderNavItem;
  className?: string;
  style?: CSSProperties;
  "aria-current"?: "page";
  onClick: () => void;
  children: ReactNode;
}

export interface HeaderProps {
  /** ブランド名 */
  brandName: string;
  /** ブランドリンクの遷移先 */
  brandHref?: string;
  /** ブランド名の左側に表示するマーク要素 */
  brandMark?: ReactNode;
  /** ナビゲーション項目の配列 */
  navItems?: readonly HeaderNavItem[];
  /** ナビゲーション領域のアクセシブル名 */
  navLabel?: string;
  /** 右側に配置するアクション要素 */
  actions?: ReactNode;
  /** モバイルメニュー開閉ボタンのアクセシブル名 */
  menuButtonLabel?: string;
  /** メインコンテンツへのスキップリンク先 */
  skipToContentHref?: string;
  /** スキップリンクのラベル */
  skipToContentLabel?: string;
  /** フレームワーク固有のリンクコンポーネントを注入するレンダラ */
  renderLink?: (params: HeaderLinkRenderParams) => ReactNode;
  /** 画面上部に固定（sticky）するか */
  sticky?: boolean;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * サイト共通のトップアプリバー型ヘッダー。
 * ブランド表示・レスポンシブなナビゲーション・右側のアクションスロットを提供する。
 */
export function Header({
  brandName,
  brandHref,
  brandMark,
  navItems = [],
  navLabel = "Primary",
  actions,
  menuButtonLabel = "Menu",
  skipToContentHref,
  skipToContentLabel = "Skip to content",
  renderLink,
  sticky = true,
  style,
}: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const hasNavItems = navItems.length > 0;

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);

  const brandContent = (
    <>
      {brandMark ? <span {...stylex.props(headerStyles.brandMark)}>{brandMark}</span> : null}
      <span {...stylex.props(headerStyles.brandName)}>{brandName}</span>
    </>
  );

  const brandStyleProps = stylex.props(headerStyles.brand);

  return (
    <header {...stylex.props(headerStyles.root, sticky && headerStyles.rootSticky, style)}>
      {skipToContentHref ? (
        <a href={skipToContentHref} {...stylex.props(headerStyles.skipLink)}>
          {skipToContentLabel}
        </a>
      ) : null}

      <div {...stylex.props(headerStyles.inner)}>
        {brandHref ? (
          renderLink ? (
            renderLink({
              item: { href: brandHref, label: brandName },
              ...brandStyleProps,
              onClick: closeMenu,
              children: brandContent,
            })
          ) : (
            <a href={brandHref} onClick={closeMenu} {...brandStyleProps}>
              {brandContent}
            </a>
          )
        ) : (
          <div {...brandStyleProps}>{brandContent}</div>
        )}

        <div {...stylex.props(headerStyles.trailing)}>
          {hasNavItems ? (
            <nav
              ref={navRef}
              aria-label={navLabel}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
              }}
              {...stylex.props(headerStyles.nav)}
            >
              <IconButton
                ref={menuButtonRef}
                variant="standard"
                size="md"
                aria-label={menuButtonLabel}
                aria-expanded={isMenuOpen}
                aria-controls={menuId}
                onClick={() => setIsMenuOpen((prev) => !prev)}
                style={headerStyles.menuButton}
              >
                <MenuIcon isOpen={isMenuOpen} />
              </IconButton>

              <ul
                id={menuId}
                {...stylex.props(headerStyles.navList, isMenuOpen && headerStyles.navListOpen)}
              >
                {navItems.map((item) => {
                  const linkProps = stylex.props(
                    headerStyles.navLink,
                    item.isCurrent && headerStyles.navLinkCurrent,
                  );
                  const ariaCurrent = item.isCurrent ? ("page" as const) : undefined;

                  return (
                    <li key={item.href} {...stylex.props(headerStyles.navItem)}>
                      {renderLink ? (
                        renderLink({
                          item,
                          ...linkProps,
                          "aria-current": ariaCurrent,
                          onClick: closeMenu,
                          children: item.label,
                        })
                      ) : (
                        <a
                          href={item.href}
                          aria-current={ariaCurrent}
                          onClick={closeMenu}
                          {...linkProps}
                        >
                          {item.label}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}

          {actions ? <div {...stylex.props(headerStyles.actions)}>{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

function MenuIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {isOpen ? (
        <path
          d="M6 6L18 18M18 6L6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 7H20M4 12H20M4 17H20"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
