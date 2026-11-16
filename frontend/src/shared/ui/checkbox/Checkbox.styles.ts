import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const checkboxStyles = stylex.create({
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: tokens.onSurface,
    cursor: "pointer",
  },
  labelDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  input: {
    width: "1.125rem",
    height: "1.125rem",
    accentColor: tokens.primary,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.primary}`,
    },
    outlineOffset: "2px",
  },
});
