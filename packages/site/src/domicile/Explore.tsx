import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { MATRIX } from "../page/community";
import { REPO, repoFile } from "../page/repo";
import { Section } from "../page/Section";

/** Where a visitor goes next, by what they want to do. */
const PATHS: readonly { href: string; title: string; body: string }[] = [
  {
    body: "Run the tiling desktop in a window on your current one.",
    href: "/manganese#try",
    title: "Try manganese",
  },
  {
    body: "One file of React or JavaScript, running in five minutes.",
    href: "/docs/shells/quickstart",
    title: "Make your own desktop",
  },
  {
    body: "How native windows and websites end up on one page.",
    href: "/docs/how-it-works",
    title: "See how it works",
  },
  {
    body: "The compositor, the Chromium patches and every package. MIT licensed.",
    href: REPO,
    title: "Explore the source",
  },
  {
    body: "Show what you built, ask questions, or help out.",
    href: MATRIX,
    title: "Join the chat",
  },
  {
    body: "Building it, testing it, and how changes land.",
    href: repoFile("docs/contributing/README.md"),
    title: "Contribute",
  },
];

/** The ways in, one line each. */
export const Explore = () => (
  <Section id="explore" title="Explore it.">
    <ul className={listStyles}>
      {PATHS.map((path) => (
        <li key={path.title}>
          <a className={pathStyles} href={path.href}>
            <span className={titleStyles}>{path.title} →</span>
            <span className={bodyStyles}>{path.body}</span>
          </a>
        </li>
      ))}
    </ul>
  </Section>
);

const listStyles = css({
  "& > li + li": { borderBlockStart: "1px solid {colors.border}" },
  borderBlock: "1px solid {colors.border}",
  listStyle: "none",
});

const pathStyles = flex({
  _focusVisible: {
    outline: "2px solid {colors.accent}",
    outlineOffset: "-2px",
  },
  _hover: { "& > span:first-child": { color: "accent" } },
  columnGap: 6,
  direction: { base: "column", md: "row" },
  justify: "space-between",
  paddingBlock: 5,
  rowGap: 1,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "xl", md: "2xl" },
  fontWeight: "semibold",
  transition: "color {durations.fast} {easings.out}",
});

const bodyStyles = css({ color: "muted", md: { textAlign: "end" } });
