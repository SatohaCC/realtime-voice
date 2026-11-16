import * as stylex from "@stylexjs/stylex";

export const fileTriggerStyles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    position: "relative",
  },
  visuallyHiddenInput: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});
