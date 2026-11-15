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
});
