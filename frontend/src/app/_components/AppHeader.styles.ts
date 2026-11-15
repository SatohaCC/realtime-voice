import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const appHeaderStyles = stylex.create({
  mark: {
    display: "grid",
    placeItems: "center",
    width: "2.25rem",
    height: "2.25rem",
    borderRadius: tokens.cornerMedium,
    backgroundColor: tokens.primary,
    color: tokens.onPrimary,
    fontSize: "1.125rem",
    fontWeight: 600,
  },
  authActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    minWidth: 0,
  },
  userLabel: {
    display: { default: "inline-block", "@media (max-width: 719px)": "none" },
    maxWidth: "12rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.8125rem",
    color: tokens.onSurfaceVariant,
  },
});
