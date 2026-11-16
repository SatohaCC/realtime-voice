import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const transcriptionPageStyles = stylex.create({
  main: {
    width: "100%",
    maxWidth: "100%",
    marginInline: "auto",
    paddingInline: { default: "2.5rem", "@media (max-width: 599px)": "1.25rem" },
    paddingTop: "1.25rem",
    paddingBottom: "1.5rem",
    minWidth: 0,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.5rem 1rem",
    marginBottom: "0.75rem",
    minWidth: 0,
  },
  title: {
    fontSize: { default: "1.5rem", "@media (max-width: 599px)": "1.25rem" },
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: tokens.onSurface,
    margin: 0,
  },
  meta: {
    fontSize: "0.875rem",
    color: tokens.onSurfaceVariant,
    margin: 0,
  },
  workspaceShell: {
    minWidth: 0,
    minHeight: 0,
  },
});
