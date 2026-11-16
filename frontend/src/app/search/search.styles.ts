import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const searchPageStyles = stylex.create({
  main: {
    maxWidth: "80rem",
    marginInline: "auto",
    paddingInline: { default: "2.5rem", "@media (max-width: 599px)": "1.25rem" },
    paddingTop: "1.75rem",
    paddingBottom: "3.5rem",
    minWidth: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    marginBottom: "1.5rem",
  },
  title: {
    margin: 0,
    fontSize: { default: "1.5rem", "@media (max-width: 599px)": "1.25rem" },
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: tokens.onSurface,
  },
  lead: {
    margin: 0,
    fontSize: "0.9375rem",
    lineHeight: 1.6,
    color: tokens.onSurfaceVariant,
  },
});
