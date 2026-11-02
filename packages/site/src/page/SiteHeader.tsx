import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { COMMUNITY, CommunityIcon } from "./community";
import { LinkButton } from "./LinkButton";

type Props = {
  /** The product's mark and name, linking home. */
  brand: ReactNode;
  links: readonly { label: string; href: string }[];
  action: { label: string; href: string };
  /** Stays at the top of the window as the page scrolls, from `md` up. */
  sticky?: boolean;
};

/** A landing page's top bar. */
export const SiteHeader = ({ brand, links, action, sticky = false }: Props) => (
  <header
    className={barStyles({ sticky })}
    data-sticky-header={sticky ? "" : undefined}
  >
    <div className={headerStyles({ sticky })}>
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
    </div>
  </header>
);

// Full width, so a sticky bar covers what scrolls under it. Below `md` the
// links wrap, and a bar that tall would eat a phone's screen.
const barStyles = cva({
  variants: {
    sticky: {
      false: {},
      true: {
        backdropFilter: { md: "blur(12px)" },
        backgroundColor: {
          md: "color-mix(in srgb, {colors.background} 85%, transparent)",
        },
        borderBlockEnd: { md: "1px solid {colors.border}" },
        insetBlockStart: { md: 0 },
        position: { md: "sticky" },
        zIndex: { md: 10 },
      },
    },
  },
});

const headerStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    justifyContent: "space-between",
    marginInline: "auto",
    maxInlineSize: "6xl",
    paddingBlock: 5,
    paddingInline: 6,
  },
  variants: {
    // Thinner once it stays put.
    sticky: { false: {}, true: { paddingBlock: { md: 3 } } },
  },
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
