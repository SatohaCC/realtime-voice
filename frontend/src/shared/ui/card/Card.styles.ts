import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

// 従来M3のCard: Filledは色面、Outlinedは境界線、Elevatedはlevel 1の影で区切る。
export const cardStyles = stylex.create({
  base: {
    minWidth: 0,
    padding: "1rem",
    borderRadius: tokens.cornerMedium,
    borderWidth: 0,
    borderStyle: "solid",
    color: tokens.onSurface,
    boxShadow: "none",
  },
  filled: {
    backgroundColor: tokens.surfaceContainerHighest,
  },
  outlined: {
    backgroundColor: tokens.surface,
    borderWidth: "1px",
    borderColor: tokens.outlineVariant,
  },
  elevated: {
    backgroundColor: tokens.surfaceContainerLow,
    boxShadow: tokens.shadow1,
  },
});
