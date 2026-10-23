import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, vstack } from "../../styled-system/patterns";

type Props = {
  /** The pill above the title. */
  tag: { label: string; href: string };
  title: ReactNode;
  lede: ReactNode;
  /** The calls to action, in a row under the lede. */
  actions: ReactNode;
  /** Anything under the actions. */
  children?: ReactNode;
};

/** A landing page's opening. */
export const Hero = ({ tag, title, lede, actions, children }: Props) => (
  <section className={heroStyles} id="top">
    <a className={tagStyles} href={tag.href}>
      {tag.label}
    </a>
    <h1 className={titleStyles}>{title}</h1>
    <p className={ledeStyles}>{lede}</p>
    <div className={actionsStyles}>{actions}</div>
    {children}
  </section>
);

const heroStyles = vstack({
  gap: 6,
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 10,
  paddingBlockStart: 18,
  paddingInline: 6,
  textAlign: "center",
});

const tagStyles = css({
  border: "1px solid color-mix(in oklab, {colors.accent} 40%, {colors.border})",
  borderRadius: "full",
  color: "accent",
  fontSize: "sm",
  fontWeight: "semibold",
  paddingBlock: 1.5,
  paddingInline: 3,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "5xl", lg: "8xl", md: "7xl" },
  fontWeight: "bold",
  letterSpacing: "tighter",
  lineHeight: "none",
  maxInlineSize: "4xl",
});

const ledeStyles = css({
  color: "muted",
  fontSize: "lg",
  maxInlineSize: "2xl",
});

const actionsStyles = flex({
  gap: 3,
  justify: "center",
  marginBlockStart: 2,
  wrap: "wrap",
});
