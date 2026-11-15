"use client";

import * as stylex from "@stylexjs/stylex";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Select as UiSelect,
} from "@ui-sdk/react/select";
import { selectStyles as s } from "./Select.styles";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: stylex.StyleXStyles;
  triggerStyle?: stylex.StyleXStyles;
}

/**
 * `@ui-sdk/react/select` を M3 スタイルで包んだ単一選択セレクトボックス。
 */
export function Select({
  label,
  hideLabel = false,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "選択してください",
  disabled = false,
  size = "md",
  style,
  triggerStyle,
}: SelectProps) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <div
      {...stylex.props(s.root, hideLabel && s.rootCompact, size === "sm" && s.rootInline, style)}
    >
      <UiSelect
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        placeholder={placeholder}
        onValueChange={(nextValue) => onValueChange?.(nextValue)}
      >
        <SelectLabel {...stylex.props(s.label, hideLabel && s.labelHidden)}>{label}</SelectLabel>
        <SelectTrigger
          className={({ disabled: isDisabled }) =>
            stylex.props(
              s.trigger,
              size === "sm" && s.triggerSm,
              isDisabled && s.triggerDisabled,
              triggerStyle,
            ).className
          }
        >
          <SelectValue placeholder={placeholder} {...stylex.props(s.value)} />
          <span {...stylex.props(s.chevron)} aria-hidden="true">
            <svg
              width={iconSize}
              height={iconSize}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </SelectTrigger>

        <SelectContent sideOffset={6} {...stylex.props(s.content, size === "sm" && s.contentSm)}>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              label={option.label}
              disabled={option.disabled}
              className={({ selected, highlighted, disabled: itemDisabled }) =>
                stylex.props(
                  s.item,
                  highlighted && s.itemHighlighted,
                  selected && s.itemSelected,
                  itemDisabled && s.itemDisabled,
                ).className
              }
            >
              <SelectItemText>{option.label}</SelectItemText>
              <SelectItemIndicator {...stylex.props(s.indicator)} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 12.5L9.5 17L19 7.5"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectContent>
      </UiSelect>
    </div>
  );
}
