import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { COMMUNITY, CommunityIcon } from "./community";
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
      <span className={iconsStyles}>
        {COMMUNITY.map((link) => (
          <a
            aria-label={link.label}
            className={iconLinkStyles}
            href={link.href}
            key={link.href}
            title={link.label}
          >
            <CommunityIcon icon={link.icon} />
          </a>
        ))}
      </span>
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

const iconsStyles = flex({ align: "center", gap: 1 });

// The icon alone, in a square as tall as the button beside it, so it is easy
// to hit.
const iconLinkStyles = flex({
  _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: "2px" },
  _hover: { backgroundColor: "card", color: "foreground" },
  align: "center",
  blockSize: 9,
  borderRadius: "md",
  color: "muted",
  fontSize: "lg",
  inlineSize: 9,
  justify: "center",
  transition:
    "color {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}",
});
