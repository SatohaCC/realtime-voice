import * as stylex from "@stylexjs/stylex";
import type { HTMLAttributes } from "react";
import { cardStyles as s } from "./Card.styles";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "style" | "className"> {
  as?: "div" | "article" | "section" | "li";
  variant?: "filled" | "outlined" | "elevated";
  style?: stylex.StyleXStyles;
}

/** M3の非インタラクティブなカード。操作は内部のボタンやリンクに持たせる。 */
export function Card({ as: Component = "div", variant = "filled", style, ...props }: CardProps) {
  return <Component {...props} {...stylex.props(s.base, s[variant], style)} />;
}
