import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const textFieldStyles = stylex.create({
  input: {
    width: "100%",
    minWidth: 0,
    minHeight: "2.75rem",
    paddingInline: "0.875rem",
    borderRadius: tokens.cornerMedium,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outline,
    backgroundColor: tokens.surfaceContainerLowest,
    color: tokens.onSurface,
    fontSize: "0.9375rem",
    fontFamily: "inherit",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.primary}`,
    },
    outlineOffset: "2px",
    ":disabled": {
      opacity: 0.6,
      cursor: "not-allowed",
    },
  },
});
