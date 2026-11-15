import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

const indeterminateSlide = stylex.keyframes({
  "0%": { transform: "translateX(-100%)" },
  "100%": { transform: "translateX(260%)" },
});

export const progressStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    width: "100%",
    minWidth: 0,
  },
  rootInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: "0.5rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    fontSize: "0.75rem",
    lineHeight: "1rem",
    color: tokens.onSurfaceVariant,
  },
  label: {
    fontWeight: 500,
    minWidth: 0,
  },
  labelHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  value: {
    fontSize: "0.75rem",
    lineHeight: "1rem",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: tokens.onSurfaceVariant,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  track: {
    flex: "1 1 0%",
    width: "100%",
    minWidth: 0,
    borderRadius: tokens.cornerFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outline,
    backgroundColor: tokens.surfaceContainerHigh,
    overflow: "clip",
  },
  trackSm: {
    height: "0.45rem",
  },
  trackMd: {
    height: "0.625rem",
  },
  indicator: {
    height: "100%",
    borderRadius: tokens.cornerFull,
    backgroundColor: {
      default: tokens.primary,
      "@media (forced-colors: active)": "Highlight",
    },
    transitionProperty: "width",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  indicatorIndeterminate: {
    width: {
      default: "38%",
      "@media (prefers-reduced-motion: reduce)": "100%",
    },
    animationName: {
      default: indeterminateSlide,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "1.4s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    animationIterationCount: "infinite",
  },
});
