"use client";

import * as stylex from "@stylexjs/stylex";
import { TabsList, TabsPanel, TabsTab, TabsTabIcon, Tabs as UiTabs } from "@ui-sdk/react/tabs";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { tabsStyles as s } from "./Tabs.styles";
import { useTabIndicator } from "./useTabIndicator";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  badge?: { label: string; count?: number };
}

export interface TabsProps {
  items: readonly TabItem[];
  "aria-label": string;
  variant?: "primary" | "secondary";
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: ComponentProps<typeof UiTabs>["onValueChange"];
  activation?: "automatic" | "manual";
  style?: stylex.StyleXStyles;
}

export function Tabs({
  items,
  "aria-label": label,
  variant = "primary",
  style,
  ...props
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useTabIndicator(listRef, variant);
  const hasIcons = variant === "primary" && items.some((item) => item.icon != null);
  return (
    <UiTabs {...props} {...stylex.props(s.root, style)}>
      <TabsList ref={listRef} aria-label={label} {...stylex.props(s.list)}>
        {items.map((item) => (
          <TabsTab
            key={item.value}
            value={item.value}
            aria-label={item.badge ? `${item.label} ${item.badge.label}` : undefined}
            disabled={item.disabled}
            className={({ selected, disabled }) =>
              stylex.props(
                s.tab,
                hasIcons && s.tabWithIcon,
                selected && (variant === "primary" ? s.primarySelected : s.secondarySelected),
                disabled && s.disabled,
              ).className
            }
          >
            <span data-tab-content="" {...stylex.props(s.content, hasIcons && s.contentWithIcon)}>
              {hasIcons ? (
                <TabsTabIcon aria-hidden="true" {...stylex.props(s.icon)}>
                  {item.icon}
                </TabsTabIcon>
              ) : null}
              <span {...stylex.props(s.label)}>
                {item.label}
                {item.badge ? (
                  <span
                    role="img"
                    aria-label={item.badge.label}
                    {...stylex.props(s.badge, item.badge.count === undefined && s.badgeDot)}
                  >
                    {item.badge.count !== undefined ? (
                      <span aria-hidden="true">
                        {item.badge.count > 999 ? "999+" : item.badge.count}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </span>
          </TabsTab>
        ))}
        <span
          data-tab-indicator=""
          aria-hidden="true"
          {...stylex.props(s.indicator, variant === "primary" && s.primaryIndicator)}
        />
      </TabsList>
      {items.map((item) => (
        <TabsPanel key={item.value} value={item.value} {...stylex.props(s.panel)}>
          {item.content}
        </TabsPanel>
      ))}
    </UiTabs>
  );
}
