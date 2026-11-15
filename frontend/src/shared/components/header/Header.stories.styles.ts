import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const headerStoryStyles = stylex.create({
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
  scrollSpacer: {
    minHeight: "120vh",
    padding: "2rem",
    color: tokens.onSurfaceVariant,
  },
});
