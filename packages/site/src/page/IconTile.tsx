import type { ReactNode } from "react";

import { center } from "../../styled-system/patterns";

/** A Phosphor icon on a tinted tile, beside a card's label. */
export const IconTile = ({ children }: { children: ReactNode }) => (
  <span aria-hidden="true" className={tileStyles}>
    {children}
  </span>
);

const tileStyles = center({
  backgroundImage:
    "linear-gradient(135deg, color-mix(in oklab, {colors.accent} 22%, {colors.card}), {colors.card})",
  blockSize: 11,
  border: "1px solid color-mix(in oklab, {colors.accent} 35%, {colors.border})",
  borderRadius: "lg",
  color: "accent",
  flex: "none",
  fontSize: "2xl",
  inlineSize: 11,
});
