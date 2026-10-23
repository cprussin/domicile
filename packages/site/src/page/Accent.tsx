import type { ReactNode } from "react";

import { cva } from "../../styled-system/css";

/** The products, each with its own color. */
export type ProductName = "domicile" | "manganese";

type Props = {
  product: ProductName;
  children: ReactNode;
};

/**
 * Sets `accent` to a product's color for everything inside, so buttons, tabs
 * and links take it.
 */
export const Accent = ({ product, children }: Props) => (
  <div className={accentStyles({ product })}>{children}</div>
);

const accentStyles = cva({
  variants: {
    product: {
      domicile: { "--colors-accent": "{colors.domicile}" },
      manganese: { "--colors-accent": "{colors.manganese}" },
    },
  },
});
