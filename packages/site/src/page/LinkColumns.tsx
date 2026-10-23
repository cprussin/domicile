import { css } from "../../styled-system/css";
import { grid } from "../../styled-system/patterns";
import { Eyebrow } from "./Eyebrow";

/** A column of links under a heading. */
export type LinkColumn = {
  title: string;
  /** `accent` for the columns a reader starts from. */
  tone: "accent" | "muted";
  links: readonly { label: string; href: string }[];
};

/** The docs index at the foot of a landing page. */
export const LinkColumns = ({
  columns,
}: {
  columns: readonly LinkColumn[];
}) => (
  <div className={gridStyles}>
    {columns.map((column) => (
      <nav
        aria-label={column.title}
        className={columnStyles}
        key={column.title}
      >
        <Eyebrow tone={column.tone}>{column.title}</Eyebrow>
        {column.links.map((link) => (
          <a className={linkStyles} href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </nav>
    ))}
  </div>
);

const gridStyles = grid({ gap: 7, minChildWidth: "13.75rem" });

const columnStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 2.5,
});

const linkStyles = css({
  _hover: { color: "accent" },
  color: "foreground",
  transition: "color {durations.fast} {easings.out}",
});
