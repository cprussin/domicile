import { css, cva } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

type Stage = {
  /** What draws or arranges at this stage. */
  title: string;
  body: string;
  /** `engine` marks the stage the browser engine runs. */
  tone?: "engine" | undefined;
};

type Diagram = {
  title: string;
  /** What feeds the first stage, side by side. */
  sources: readonly string[];
  stages: readonly Stage[];
};

const CONVENTIONAL: Diagram = {
  sources: ["Websites, in a browser", "Native apps"],
  stages: [
    {
      body: "The browser renders and composites its pages into one window, with its own engine. Each native app draws its own window.",
      title: "Each app draws a window",
      tone: "engine",
    },
    {
      body: "Arranges every window, the browser's included, and composites them.",
      title: "The desktop compositor",
    },
    { body: "", title: "The screen" },
  ],
  title: "A typical desktop",
};

const DOMICILE: Diagram = {
  sources: ["Websites: <webview>", "Native apps: <app>", "Your desktop: HTML"],
  stages: [
    {
      body: "Apps still draw their own windows, and Domicile's Wayland server hands them to the engine. The engine lays out the page, the websites and the windows with CSS, and composites them in one frame.",
      title: "One page, in Chromium",
      tone: "engine",
    },
    { body: "", title: "The screen" },
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

/** One arrangement: its sources over its stages, top to bottom. */
const Flow = ({ diagram }: { diagram: Diagram }) => (
  <figure className={flowStyles}>
    <figcaption className={flowTitleStyles}>{diagram.title}</figcaption>
    <ul className={sourcesStyles}>
      {diagram.sources.map((source) => (
        <li className={sourceStyles} key={source}>
          {source}
        </li>
      ))}
    </ul>
    <ol className={stagesStyles}>
      {diagram.stages.map((stage) => (
        <li className={stageWrapStyles} key={stage.title}>
          <span aria-hidden="true" className={arrowStyles}>
            ↓
          </span>
          <div className={stageStyles({ tone: stage.tone ?? "plain" })}>
            <span className={stageTitleStyles}>{stage.title}</span>
            {stage.body === "" ? undefined : (
              <span className={stageBodyStyles}>{stage.body}</span>
            )}
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
  gap: 3,
  padding: { base: 5, md: 7 },
});

const flowTitleStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "bold",
});

const sourcesStyles = flex({ gap: 2, listStyle: "none", wrap: "wrap" });

const sourceStyles = css({
  border: "1px dashed {colors.border}",
  borderRadius: "lg",
  flex: "1 1 8rem",
  fontFamily: "mono",
  fontSize: "sm",
  paddingBlock: 2,
  paddingInline: 3,
  textAlign: "center",
});

const stagesStyles = flex({ direction: "column", gap: 0, listStyle: "none" });

const stageWrapStyles = flex({ align: "center", direction: "column" });

const arrowStyles = css({ color: "muted", fontSize: "lg", lineHeight: "1.6" });

const stageStyles = cva({
  base: {
    borderRadius: "lg",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    inlineSize: "100%",
    paddingBlock: 3,
    paddingInline: 4,
  },
  variants: {
    tone: {
      engine: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 14%, {colors.card})",
        border:
          "1px solid color-mix(in oklab, {colors.accent} 45%, {colors.border})",
      },
      plain: { border: "1px solid {colors.border}" },
    },
  },
});

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
