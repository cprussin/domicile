import type { ReactNode } from "react";

import { css } from "../../styled-system/css";

type Props = {
  id?: string | undefined;
  title?: string | undefined;
  lede?: string | undefined;
  children: ReactNode;
};

/** A landing page section: a heading, a line under it, then its content. */
export const Section = ({ id, title, lede, children }: Props) => (
  <section className={sectionStyles} id={id}>
    {title === undefined ? undefined : <h2 className={titleStyles}>{title}</h2>}
    {lede === undefined ? undefined : <p className={ledeStyles}>{lede}</p>}
    {children}
  </section>
);

const sectionStyles = css({
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 28,
  paddingInline: 6,
  scrollMarginBlockStart: 6,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "3xl", md: "5xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
  marginBlockEnd: 2,
});

const ledeStyles = css({
  color: "muted",
  fontSize: "lg",
  marginBlockEnd: 8,
});
