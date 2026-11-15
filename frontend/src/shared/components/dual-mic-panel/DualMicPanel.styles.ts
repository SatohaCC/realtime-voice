import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const dualMicPanelStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    minWidth: 0,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  title: {
    fontSize: "1.0625rem",
    lineHeight: "1.5rem",
    fontWeight: 600,
    color: tokens.onSurface,
  },
  headerActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
  },
  channelsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
    gap: "1.25rem",
    minWidth: 0,
  },
  channelCard: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1.25rem",
    transitionProperty: "border-color, background-color",
    transitionDuration: tokens.motionDuration,
    transitionTimingFunction: tokens.motionEasing,
  },
  channelCardActive: {
    borderColor: tokens.primary,
    backgroundColor: tokens.surfaceContainerHigh,
  },
  channelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  channelTitle: {
    fontSize: "0.9375rem",
    fontWeight: 600,
    color: tokens.onSurface,
  },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    paddingTop: "0.25rem",
  },
  stats: {
    fontSize: "0.8125rem",
    color: tokens.onSurfaceVariant,
  },
});
