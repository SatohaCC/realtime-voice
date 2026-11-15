import * as stylex from "@stylexjs/stylex";
import { googleIdentity } from "../../styles/google-identity.stylex";

export const googleSignInButtonStyles = stylex.create({
  button: {
    width: "100%",
    minHeight: 40,
    paddingInline: 12,
    gap: 10,
    backgroundColor: googleIdentity.container,
    color: googleIdentity.content,
    borderColor: googleIdentity.outline,
    borderRadius: 20,
    borderStartStartRadius: { default: 20, ":active": 20 },
    borderStartEndRadius: { default: 20, ":active": 20 },
    borderEndStartRadius: { default: 20, ":active": 20 },
    borderEndEndRadius: { default: 20, ":active": 20 },
    fontFamily: '"Google Sign In", system-ui, sans-serif',
    fontSize: 14,
    lineHeight: "20px",
    fontWeight: 500,
    letterSpacing: 0,
    backgroundImage: {
      default: "none",
      ":hover": "none",
      ":focus-visible": "none",
      ":active": "none",
    },
    boxShadow: { default: "none", ":hover": "0 1px 2px rgb(0 0 0 / 20%)" },
  },
  logo: { flexShrink: 0, objectFit: "contain" },
  label: { flexGrow: 1, textAlign: "center" },
});
