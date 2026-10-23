import type { ReactNode } from "react";

import { cva } from "../../styled-system/css";

type Props = {
  children: ReactNode;
  tone?: "accent" | "muted" | undefined;
};

/** A small label above a heading or a card's title. */
export const Eyebrow = ({ children, tone = "accent" }: Props) => (
  <span className={eyebrowStyles({ tone })}>{children}</span>
);

const eyebrowStyles = cva({
  base: {
    fontSize: "sm",
    fontWeight: "semibold",
    letterSpacing: "wider",
    textTransform: "uppercase",
  },
  variants: {
    tone: {
      accent: { color: "accent" },
      muted: { color: "muted" },
    },
  },
});
