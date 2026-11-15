import * as stylex from "@stylexjs/stylex";

export const loginPageStyles = stylex.create({
  main: {
    maxWidth: "80rem",
    marginInline: "auto",
    paddingInline: { default: "2.5rem", "@media (max-width: 599px)": "1.25rem" },
    paddingBlock: { default: "4rem", "@media (max-width: 599px)": "2.5rem" },
  },
});
