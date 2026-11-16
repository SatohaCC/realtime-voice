import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const chipStyles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.375rem",
    minHeight: "2rem",
    paddingInline: "0.75rem",
    paddingBlock: "0.25rem",
    borderRadius: tokens.cornerSmall,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outlineVariant,
    backgroundColor: {
      default: tokens.surfaceContainerLowest,
      "@media (hover: hover)": { ":hover": tokens.surfaceContainerHigh },
    },
    color: tokens.onSurface,
    fontSize: "0.8125rem",
    lineHeight: 1.4,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.primary}`,
    },
    outlineOffset: "2px",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  selected: {
    backgroundColor: {
      default: tokens.secondaryContainer,
      "@media (hover: hover)": { ":hover": tokens.secondaryContainer },
    },
    borderColor: tokens.secondary,
    color: tokens.onSecondaryContainer,
    fontWeight: 600,
  },
  disabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
});
