import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../shared/styles/tokens.stylex";

export const realtimeTranscriptionContainerStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "2rem",
    minWidth: 0,
  },
  divider: {
    height: "1px",
    border: 0,
    backgroundColor: tokens.outlineVariant,
  },
});
