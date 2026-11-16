import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

const NARROW_BP = "@media (max-width: 1023px)";

export const realtimeTranscriptionContainerStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
    minWidth: 0,
    minHeight: 0,
  },
  mobileTabsWrap: {
    display: { default: "none", [NARROW_BP]: "flex" },
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.25rem",
    borderRadius: tokens.cornerFull,
    backgroundColor: tokens.surfaceContainerLow,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outline,
    alignSelf: "flex-start",
  },
  mobileTabButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    minHeight: "2.75rem",
    paddingInline: "1rem",
    paddingBlock: "0.35rem",
    borderRadius: tokens.cornerFull,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.onSurfaceVariant,
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `3px solid ${tokens.primary}`,
    },
    outlineOffset: "2px",
    transitionProperty: "background-color, color",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  mobileTabButtonActive: {
    backgroundColor: tokens.primaryContainer,
    color: tokens.onPrimaryContainer,
  },
  workspaceGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1fr)",
      [NARROW_BP]: "minmax(0, 1fr)",
    },
    gap: "1rem",
    height: {
      default: "clamp(34rem, calc(100dvh - 14.5rem), 72rem)",
      [NARROW_BP]: "auto",
    },
    minWidth: 0,
    minHeight: 0,
  },
  paneColumn: {
    minWidth: 0,
    minHeight: 0,
    height: {
      default: "100%",
      [NARROW_BP]: "auto",
    },
    display: "flex",
    flexDirection: "column",
  },
  paneHiddenNarrow: {
    display: {
      default: "flex",
      [NARROW_BP]: "none",
    },
  },
});
