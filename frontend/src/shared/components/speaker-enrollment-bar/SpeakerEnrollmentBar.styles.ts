import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const speakerEnrollmentBarStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
    padding: "0.625rem 1rem",
    backgroundColor: tokens.surfaceContainerLow,
    borderRadius: tokens.cornerMedium,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outlineVariant,
    minWidth: 0,
    flexShrink: 0,
  },
  mainRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.625rem",
    minWidth: 0,
  },
  infoGroup: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    minWidth: 0,
    flex: "1 1 16rem",
  },
  title: {
    margin: 0,
    fontSize: "0.875rem",
    fontWeight: 600,
    color: tokens.onSurface,
  },
  description: {
    fontSize: "0.8125rem",
    color: tokens.onSurfaceVariant,
  },
  actionsGroup: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    flexShrink: 0,
  },
});
