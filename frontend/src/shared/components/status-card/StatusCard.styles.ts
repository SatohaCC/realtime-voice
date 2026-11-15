import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const statusCardStyles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1.25rem" },
  row: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.75rem",
    minWidth: 0,
  },
  label: {
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    fontWeight: 500,
    color: tokens.onSurfaceVariant,
  },
});
