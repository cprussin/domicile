import { Button } from "@domicile-desktop/component-library/Button";
import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import { Notice } from "./Notice";
import { changesUnder, useTemporaryChanges } from "./temporary-changes";

type Props = {
  title: string;
  description: string;
  /** Why the page's settings cannot change, shown above them. */
  readOnly?: string | undefined;
  children?: ReactNode;
};

/**
 * A page's heading, its read-only notice or what it changes only until the
 * desktop restarts, and its settings.
 */
export const Page = ({ children, description, readOnly, title }: Props) => (
  <article className={pageStyles}>
    <header className={headerStyles}>
      <h1 className={titleStyles}>{title}</h1>
      <p className={descriptionStyles}>{description}</p>
    </header>
    {readOnly === undefined ? (
      <TemporaryNotice />
    ) : (
      <Notice tone="locked">{readOnly}</Notice>
    )}
    {children}
  </article>
);

/**
 * How many of the page's settings a temporary change has, with a button to
 * end them; and, on a config the desktop cannot write, that changes made here
 * are temporary.
 */
const TemporaryNotice = () => {
  const changes = useTemporaryChanges();
  if (changes === undefined) {
    return undefined;
  } else {
    const { length } = changesUnder(changes.overrides, changes.sections);
    if (length === 0 && !changes.temporary) {
      return undefined;
    } else if (length === 0) {
      return (
        <Notice>
          Your config file can't be changed here, so changes you make last until
          the desktop restarts or your config changes them.
        </Notice>
      );
    } else {
      return (
        <Notice>
          <span className={temporaryStyles}>
            <span>
              {length === 1
                ? "1 setting differs from your config until the desktop restarts or your config changes it."
                : `${String(length)} settings differ from your config until the desktop restarts or your config changes them.`}
            </span>
            <Button
              onClick={() => {
                changes.reset(changes.sections);
              }}
              size="sm"
              variant="outline"
            >
              Reset all
            </Button>
          </span>
        </Notice>
      );
    }
  }
};

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

const temporaryStyles = flex({
  alignItems: "center",
  gap: 3,
  justify: "space-between",
  wrap: "wrap",
});
