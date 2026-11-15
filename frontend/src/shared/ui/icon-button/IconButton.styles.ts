import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const iconButtonStyles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
    borderRadius: tokens.cornerFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `3px solid ${tokens.primary}` },
    outlineOffset: "2px",
    backgroundImage: {
      default: "none",
      ":focus-visible": tokens.stateFocus,
      "@media (hover: hover)": { ":hover": tokens.stateHover },
      ":active": tokens.statePress,
    },
    transitionProperty: "background-color, color, border-color",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  sm: {
    width: { default: "1.75rem", "@media (pointer: coarse)": "2.75rem" },
    height: { default: "1.75rem", "@media (pointer: coarse)": "2.75rem" },
  },
  md: {
    width: "2.75rem",
    height: "2.75rem",
  },
  standard: {
    backgroundColor: "transparent",
    color: "inherit",
  },
  filled: {
    backgroundColor: tokens.primary,
    color: tokens.onPrimary,
  },
  tonal: {
    backgroundColor: tokens.secondaryContainer,
    color: tokens.onSecondaryContainer,
  },
  outlined: {
    backgroundColor: "transparent",
    color: tokens.onSurfaceVariant,
    borderColor: tokens.outline,
  },
  pressedStandard: {
    backgroundColor: tokens.secondaryContainer,
    color: tokens.onSecondaryContainer,
  },
  disabled: {
    color: tokens.disabledContent,
    cursor: "not-allowed",
    backgroundImage: {
      default: "none",
      ":focus-visible": "none",
      "@media (hover: hover)": { ":hover": "none" },
      ":active": "none",
    },
  },
  disabledContainer: {
    backgroundColor: tokens.disabledContainer,
  },
  disabledOutline: {
    borderColor: tokens.disabledContainer,
  },
});
