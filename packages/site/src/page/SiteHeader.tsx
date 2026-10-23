import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { LinkButton } from "./LinkButton";

type Props = {
  /** The product's mark and name, linking home. */
  brand: ReactNode;
  links: readonly { label: string; href: string }[];
  action: { label: string; href: string };
};

/** A landing page's top bar. */
export const SiteHeader = ({ brand, links, action }: Props) => (
  <header className={headerStyles}>
    {brand}
    <nav aria-label="Main" className={navStyles}>
      {links.map((link) => (
        <a className={linkStyles} href={link.href} key={link.label}>
          {link.label}
        </a>
      ))}
      <LinkButton href={action.href}>{action.label}</LinkButton>
    </nav>
  </header>
);

const headerStyles = flex({
  align: "center",
  gap: 4,
  justify: "space-between",
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlock: 5,
  paddingInline: 6,
  wrap: "wrap",
});

const navStyles = flex({
  align: "center",
  columnGap: 6,
  fontSize: "sm",
  rowGap: 1,
  wrap: "wrap",
});

const linkStyles = css({
  _hover: { color: "foreground" },
  color: "muted",
  transition: "color {durations.fast} {easings.out}",
});
