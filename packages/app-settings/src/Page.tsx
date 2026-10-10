import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import { Notice } from "./Notice";

type Props = {
  title: string;
  description: string;
  /** Why the page's settings cannot change, shown above them. */
  readOnly?: string | undefined;
  children?: ReactNode;
};

/** A page's heading, its read-only notice, and its settings. */
export const Page = ({ children, description, readOnly, title }: Props) => (
  <article className={pageStyles}>
    <header className={headerStyles}>
      <h1 className={titleStyles}>{title}</h1>
      <p className={descriptionStyles}>{description}</p>
    </header>
    {readOnly !== undefined && <Notice>{readOnly}</Notice>}
    {children}
  </article>
);

const pageStyles = flex({
  animation: "rise {durations.normal} {easings.out}",
  direction: "column",
  gap: 5,
  marginInline: "auto",
  maxInlineSize: 200,
  paddingBlock: 10,
  paddingInline: 8,
});

const headerStyles = flex({ direction: "column", gap: 1 });

const titleStyles = css({
  color: "foreground",
  fontSize: "2xl",
  fontWeight: "semibold",
  letterSpacing: "tight",
  margin: 0,
});

const descriptionStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
});
