import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const bannerStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.625rem",
    borderWidth: "1px",
    borderStyle: "solid",
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  },
  sm: {
    borderRadius: tokens.cornerSmall,
    paddingBlock: "0.45rem",
    paddingInline: "0.75rem",
    fontSize: "0.8125rem",
  },
  md: {
    borderRadius: tokens.cornerMedium,
    paddingBlock: "0.75rem",
    paddingInline: "1rem",
    fontSize: "0.875rem",
  },
  info: {
    backgroundColor: tokens.secondaryContainer,
    color: tokens.onSecondaryContainer,
    borderColor: tokens.outlineVariant,
  },
  danger: {
    backgroundColor: tokens.errorContainer,
    color: tokens.onErrorContainer,
    borderColor: tokens.error,
  },
  success: {
    backgroundColor: tokens.successContainer,
    color: tokens.onSuccessContainer,
    borderColor: tokens.outlineVariant,
  },
  neutral: {
    backgroundColor: tokens.surfaceContainerHigh,
    color: tokens.onSurface,
    borderColor: tokens.outlineVariant,
  },
  content: {
    width: "100%",
    minWidth: 0,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
  },
});
