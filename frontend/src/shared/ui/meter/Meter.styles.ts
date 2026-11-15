import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const meterStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    width: "100%",
    minWidth: 0,
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
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    flexShrink: 0,
  },
  track: {
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
    transitionProperty: "width, background-color",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  indicatorPrimary: {
    backgroundColor: {
      default: tokens.primary,
      "@media (forced-colors: active)": "Highlight",
    },
  },
  indicatorTertiary: {
    backgroundColor: {
      default: tokens.tertiary,
      "@media (forced-colors: active)": "Highlight",
    },
  },
});
