import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const transcriptionPageStyles = stylex.create({
  main: {
    width: "100%",
    maxWidth: "100%",
    marginInline: "auto",
    paddingInline: { default: "1.5rem", "@media (max-width: 760px)": "0.75rem" },
    paddingTop: "0.75rem",
    paddingBottom: "1rem",
    minWidth: 0,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.5rem 1rem",
    marginBottom: "0.625rem",
    minWidth: 0,
  },
  title: {
    fontSize: { default: "1.25rem", "@media (max-width: 599px)": "1.125rem" },
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: tokens.onSurface,
    margin: 0,
  },
  meta: {
    fontSize: "0.8125rem",
    color: tokens.onSurfaceVariant,
    margin: 0,
  },
  workspaceShell: {
    minWidth: 0,
    minHeight: 0,
  },
});
