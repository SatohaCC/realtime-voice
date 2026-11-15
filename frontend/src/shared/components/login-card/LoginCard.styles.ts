import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../styles/tokens.stylex";

export const loginCardStyles = stylex.create({
  card: {
    width: "100%",
    maxWidth: "28rem",
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    backgroundColor: tokens.surfaceContainerLow,
    color: tokens.onSurface,
    borderRadius: tokens.cornerExtraLarge,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.outlineVariant,
    padding: { default: "2rem", "@media (max-width: 599px)": "1.5rem" },
    minWidth: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  title: {
    fontSize: "1.5rem",
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: tokens.onSurface,
    margin: 0,
  },
  description: {
    fontSize: "0.9375rem",
    lineHeight: 1.6,
    color: tokens.onSurfaceVariant,
    margin: 0,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    minWidth: 0,
  },
  providerButton: {
    width: "100%",
    justifyContent: "center",
  },
  errorBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.75rem",
    backgroundColor: tokens.errorContainer,
    color: tokens.onErrorContainer,
    borderRadius: tokens.cornerLarge,
    padding: "1rem",
    fontSize: "0.875rem",
    lineHeight: 1.5,
  },
  errorText: {
    margin: 0,
    overflowWrap: "anywhere",
  },
  footerNote: {
    fontSize: "0.8125rem",
    lineHeight: 1.5,
    color: tokens.onSurfaceVariant,
    margin: 0,
  },
});
