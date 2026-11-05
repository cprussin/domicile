import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BrowsersIcon } from "@phosphor-icons/react/dist/ssr/Browsers";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

type Stage = {
  icon: ReactNode;
  /** What draws or arranges at this stage. */
  title: string;
  body: string;
  /** `engine` marks the stage the browser engine runs. */
  tone?: "engine" | undefined;
};

type Source = {
  label: string;
  /** How the source appears on the page, if it does. */
  code?: string | undefined;
};

type Diagram = {
  title: string;
  /** What feeds the first stage, side by side. */
  sources: readonly Source[];
  stages: readonly Stage[];
};

const CONVENTIONAL: Diagram = {
  sources: [{ label: "Websites, in a browser" }, { label: "Native apps" }],
  stages: [
    {
      body: "The browser renders and composites its pages into one window, with its own engine. Each native app draws its own window.",
      icon: <AppWindowIcon />,
      title: "Each app draws a window",
      tone: "engine",
    },
    {
      body: "Arranges every window, the browser's included, and composites them.",
      icon: <StackIcon />,
      title: "The desktop compositor",
    },
    { body: "", icon: <MonitorIcon />, title: "The screen" },
  ],
  title: "A typical desktop",
};

const DOMICILE: Diagram = {
  sources: [
    { code: "<webview>", label: "Websites" },
    { code: "<app>", label: "Native apps" },
    { code: "HTML", label: "Your desktop" },
  ],
  stages: [
    {
      body: "Apps still draw their own windows, and Domicile's Wayland server hands them to the engine. The engine lays out the page, the websites and the windows with CSS, and composites them in one frame.",
      icon: <BrowsersIcon />,
      title: "One page, in Chromium",
      tone: "engine",
    },
    { body: "", icon: <MonitorIcon />, title: "The screen" },
  ],
  title: "Domicile",
};

/** Why unify: the two arrangements, side by side. */
export const Why = () => (
  <Section
    id="why"
    lede="On most desktops the browser is one app among many. It has its own rendering engine and compositor, and it runs in a window that a separate desktop compositor arranges. That's a sound design. Domicile tries the other one."
    title="You're already running a browser."
  >
    <div className={diagramsStyles}>
      <Flow diagram={CONVENTIONAL} />
      <Flow diagram={DOMICILE} />
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

/** One arrangement: its sources over its stages, top to bottom. The last
 * stage, the screen, sits at the bottom, so both diagrams end level. */
const Flow = ({ diagram }: { diagram: Diagram }) => (
  <figure className={flowStyles}>
    <figcaption className={flowTitleStyles}>{diagram.title}</figcaption>
    <ul className={sourcesStyles}>
      {diagram.sources.map((source) => (
        <li className={sourceStyles} key={source.label}>
          <span>{source.label}</span>
          {source.code === undefined ? undefined : (
            <code className={sourceCodeStyles}>{source.code}</code>
          )}
        </li>
      ))}
    </ul>
    <ol className={stagesStyles}>
      {diagram.stages.map((stage, index) => (
        <li
          className={stageWrapStyles({
            last: index === diagram.stages.length - 1,
          })}
          key={stage.title}
        >
          <span aria-hidden="true" className={connectorStyles} />
          <div className={stageStyles({ tone: stage.tone ?? "plain" })}>
            <span aria-hidden="true" className={stageIconStyles}>
              {stage.icon}
            </span>
            <div className={stageTextStyles}>
              <span className={stageTitleStyles}>{stage.title}</span>
              {stage.body === "" ? undefined : (
                <span className={stageBodyStyles}>{stage.body}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  </figure>
);

const diagramsStyles = grid({
  gap: 5,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
});

const flowStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  gap: 4,
  padding: { base: 5, md: 7 },
});

const flowTitleStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "bold",
});

const sourcesStyles = grid({
  gap: 2,
  gridAutoColumns: "minmax(0, 1fr)",
  gridAutoFlow: "column",
  listStyle: "none",
});

const sourceStyles = flex({
  align: "center",
  backgroundColor: "background",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  direction: "column",
  fontSize: "sm",
  fontWeight: "medium",
  gap: 0.5,
  justify: "center",
  paddingBlock: 2.5,
  paddingInline: 3,
  textAlign: "center",
});

const sourceCodeStyles = css({
  color: "accent",
  fontFamily: "mono",
  fontSize: "xs",
});

const stagesStyles = flex({
  direction: "column",
  flex: 1,
  listStyle: "none",
});

// The screen's connector stretches, so the screen sits at the bottom.
const stageWrapStyles = cva({
  base: { display: "flex", flexDirection: "column" },
  variants: { last: { false: {}, true: { flex: 1 } } },
});

// A line down to the stage, ending in an arrowhead.
const connectorStyles = css({
  _after: {
    borderInline: "5px solid transparent",
    borderTop: "6px solid {colors.border}",
    content: '""',
    insetBlockEnd: "-1px",
    insetInlineStart: "50%",
    position: "absolute",
    translate: "-50% 0",
  },
  alignSelf: "center",
  backgroundColor: "border",
  blockSize: 6,
  flex: 1,
  inlineSize: "1px",
  marginBlockEnd: 1,
  minBlockSize: 6,
  position: "relative",
});

const stageStyles = cva({
  base: {
    alignItems: "flex-start",
    borderRadius: "xl",
    display: "flex",
    gap: 3,
    paddingBlock: 3.5,
    paddingInline: 4,
  },
  variants: {
    tone: {
      engine: {
        backgroundImage:
          "linear-gradient(135deg, color-mix(in oklab, {colors.accent} 18%, {colors.card}), color-mix(in oklab, {colors.accent} 6%, {colors.card}))",
        border:
          "1px solid color-mix(in oklab, {colors.accent} 45%, {colors.border})",
      },
      plain: {
        backgroundColor: "background",
        border: "1px solid {colors.border}",
      },
    },
  },
});

const stageIconStyles = css({
  color: "accent",
  flex: "none",
  fontSize: "xl",
  lineHeight: "1",
  marginBlockStart: "0.1em",
});

const stageTextStyles = flex({ direction: "column", gap: 1 });

const stageTitleStyles = css({ fontWeight: "semibold" });

const stageBodyStyles = css({ color: "muted", fontSize: "sm" });

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
