import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const transcriptionPageStyles = stylex.create({
  main: {
    maxWidth: "80rem",
    marginInline: "auto",
    paddingInline: { default: "2.5rem", "@media (max-width: 599px)": "1.25rem" },
    paddingTop: "2rem",
    paddingBottom: "3rem",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  title: {
    fontSize: { default: "1.75rem", "@media (max-width: 599px)": "1.5rem" },
    lineHeight: 1.3,
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
  panel: {
    backgroundColor: tokens.surfaceContainerLow,
    borderRadius: tokens.cornerExtraLarge,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outlineVariant,
    padding: { default: "1.75rem", "@media (max-width: 599px)": "1.25rem" },
    minWidth: 0,
  },
  panelDescription: {
    fontSize: "0.9375rem",
    lineHeight: 1.7,
    color: tokens.onSurfaceVariant,
    marginTop: 0,
    marginBottom: "1.5rem",
  },
});
