import { css, cva } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

type Window = {
  title: string;
  /** What the window shows. */
  body: string;
  /** `engine` marks the window a browser engine draws. */
  tone?: "engine" | undefined;
};

/** A typical desktop: the browser is one window among others. */
const WINDOWS: readonly Window[] = [
  {
    body: "Websites, drawn by the browser's own engine and compositor",
    title: "Browser",
    tone: "engine",
  },
  { body: "A native app, in its own window", title: "Terminal" },
  { body: "A native app, in its own window", title: "Files" },
];

type Element = {
  /** The element's tag, as in the shell's HTML. */
  tag: string;
  label: string;
  /** A CSS transform, to show that CSS reaches it. */
  transform?: string | undefined;
};

/** Domicile: websites, native apps and the desktop's own interface are
 * elements of one page. */
const ELEMENTS: readonly Element[] = [
  { label: "A website", tag: "<webview>" },
  { label: "Terminal", tag: "<app>", transform: "rotate(-3deg)" },
  { label: "Files", tag: "<app>" },
];

/** Why unify: the two arrangements, side by side. */
export const Why = () => (
  <Section
    id="why"
    lede="On most desktops the browser is one app among many. It has its own rendering engine and compositor, and it runs in a window that a separate desktop compositor arranges. That's a sound design. Domicile tries the other one."
    title="You're already running a browser."
  >
    <div className={diagramsStyles}>
      <figure className={panelStyles}>
        <figcaption className={captionStyles}>
          <span className={panelTitleStyles}>A typical desktop</span>
          <span className={panelBodyStyles}>The web lives in one window.</span>
        </figcaption>
        <div className={screenStyles({ tone: "plain" })}>
          <span className={screenLabelStyles({ tone: "plain" })}>
            The desktop compositor
          </span>
          <ul className={windowsStyles}>
            {WINDOWS.map((window) => (
              <li
                className={windowStyles({ tone: window.tone ?? "plain" })}
                key={window.title}
              >
                <span className={titleBarStyles}>
                  <span aria-hidden="true" className={dotsStyles}>
                    ● ● ●
                  </span>
                  {window.title}
                </span>
                <span className={windowBodyStyles}>{window.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </figure>
      <figure className={panelStyles}>
        <figcaption className={captionStyles}>
          <span className={panelTitleStyles}>Domicile</span>
          <span className={panelBodyStyles}>The web is the desktop.</span>
        </figcaption>
        <div className={screenStyles({ tone: "engine" })}>
          <span className={screenLabelStyles({ tone: "engine" })}>
            One page, in Chromium
          </span>
          <div className={elementStyles}>
            <span className={tagStyles}>{"<nav>"}</span>
            <span className={elementBodyStyles}>
              Your desktop&apos;s bar, in HTML
            </span>
          </div>
          <ul className={windowsStyles}>
            {ELEMENTS.map((element) => (
              <li
                className={elementStyles}
                key={element.label}
                style={{ transform: element.transform }}
              >
                <span className={tagStyles}>{element.tag}</span>
                <span className={elementBodyStyles}>{element.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </figure>
    </div>
    <ul className={notesStyles}>
      <li>
        Websites still render in their own processes, and apps in theirs. What
        changes is what arranges and composites them: one engine, with CSS.
      </li>
      <li>
        It's a different arrangement, not a speedup. Pixels are still drawn,
        imported and composited.{" "}
        <a
          className={linkStyles}
          href={repoFile("docs/architecture/ENGINE-FORK-MEASUREMENTS.md")}
        >
          What's been measured
        </a>
      </li>
    </ul>
    <a className={moreStyles} href="/docs/how-it-works">
      How it works →
    </a>
  </Section>
);

const diagramsStyles = grid({
  gap: 5,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
});

const panelStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  gap: 5,
  padding: { base: 5, md: 7 },
});

const captionStyles = flex({ direction: "column", gap: 1 });

const panelTitleStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "bold",
});

const panelBodyStyles = css({ color: "muted" });

const engineBackground =
  "color-mix(in oklab, {colors.accent} 14%, {colors.card})";
const engineBorder =
  "1px solid color-mix(in oklab, {colors.accent} 45%, {colors.border})";

// The screen: what composites everything inside it.
const screenStyles = cva({
  base: {
    borderRadius: "xl",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: 3,
    padding: 4,
  },
  variants: {
    tone: {
      engine: { backgroundColor: engineBackground, border: engineBorder },
      plain: { border: "1px dashed {colors.border}" },
    },
  },
});

const screenLabelStyles = cva({
  base: { fontSize: "sm", fontWeight: "semibold" },
  variants: {
    tone: { engine: { color: "accent" }, plain: { color: "muted" } },
  },
});

const windowsStyles = grid({
  flex: 1,
  gap: 3,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  listStyle: "none",
});

// A window, with its own frame.
const windowStyles = cva({
  base: {
    backgroundColor: "background",
    borderRadius: "lg",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  variants: {
    tone: {
      engine: { backgroundColor: engineBackground, border: engineBorder },
      plain: { border: "1px solid {colors.border}" },
    },
  },
});

const titleBarStyles = flex({
  align: "center",
  borderBlockEnd: "1px solid {colors.border}",
  fontSize: "xs",
  fontWeight: "semibold",
  gap: 2,
  paddingBlock: 1.5,
  paddingInline: 2,
});

const dotsStyles = css({
  color: "muted",
  flexShrink: 0,
  fontSize: "2xs",
  letterSpacing: "-0.1em",
  whiteSpace: "nowrap",
});

const windowBodyStyles = css({
  color: "muted",
  fontSize: "xs",
  padding: 2,
});

// An element, outlined as a browser's inspector highlights one.
const elementStyles = flex({
  backgroundColor: "background",
  border: "1px dashed color-mix(in oklab, {colors.accent} 70%, transparent)",
  borderRadius: "md",
  direction: "column",
  gap: 1,
  padding: 2,
});

const tagStyles = css({
  color: "accent",
  fontFamily: "mono",
  fontSize: "xs",
  fontWeight: "semibold",
});

const elementBodyStyles = css({ color: "muted", fontSize: "xs" });

const notesStyles = flex({
  color: "muted",
  direction: "column",
  gap: 2,
  listStyle: "disc",
  marginBlockStart: 6,
  maxInlineSize: "3xl",
  paddingInlineStart: 5,
});

const linkStyles = css({ color: "foreground", textDecoration: "underline" });

const moreStyles = css({
  _hover: { color: "accent" },
  color: "foreground",
  display: "inline-block",
  fontWeight: "semibold",
  marginBlockStart: 5,
});
