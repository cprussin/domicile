import { css } from "../../styled-system/css";
import type { PageSection } from "./sections";

type Props = { sections: readonly PageSection[] };

/** A page's sections, each a link to its heading. */
export const Contents = ({ sections }: Props) => (
  <nav aria-label="On this page" className={navStyles}>
    <ul className={listStyles}>
      {sections.map((section) => (
        <li key={section.id}>
          <a className={linkStyles} href={`#${section.id}`}>
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  </nav>
);

const navStyles = css({ fontSize: "sm" });

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const linkStyles = css({
  _hover: { color: "accent" },
  color: "muted",
  overflowWrap: "anywhere",
  transition: "color {durations.fast} {easings.out}",
});
