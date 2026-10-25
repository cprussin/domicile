import { css } from "../../styled-system/css";
import { Eyebrow } from "../page/Eyebrow";
import type { DocSection } from "./pages";

type Props = {
  sections: readonly DocSection[];
  /** The slug of the page being read. */
  current: string;
};

/** Every docs page, by section, with the one being read marked. */
export const Sidebar = ({ sections, current }: Props) => (
  <nav aria-label="Docs" className={navStyles}>
    {sections.map((section) => (
      <div className={sectionStyles} key={section.title}>
        <Eyebrow tone="accent">{section.title}</Eyebrow>
        {section.pages.map((page) => (
          <a
            aria-current={page.slug === current ? "page" : undefined}
            className={linkStyles}
            href={`/docs/${page.slug}`}
            key={page.slug}
          >
            {page.title}
          </a>
        ))}
      </div>
    ))}
  </nav>
);

const navStyles = css({
  display: "flex",
  flexDirection: "column",
  fontSize: "sm",
  gap: 6,
});

const sectionStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 2,
});

const linkStyles = css({
  _hover: { color: "accent" },
  "&[aria-current=page]": { color: "accent", fontWeight: "semibold" },
  color: "muted",
  transition: "color {durations.fast} {easings.out}",
});
