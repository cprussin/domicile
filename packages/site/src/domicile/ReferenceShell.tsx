import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Accent } from "../page/Accent";
import { LinkButton } from "../page/LinkButton";
import { Section } from "../page/Section";

const SHELL = `import { runManganese, DEFAULT_BAR } from "@domicile-desktop/manganese";
import { Battery } from "@domicile-desktop/manganese-bar-module-battery";

export const Shell = runManganese({
  bar: {
    ...DEFAULT_BAR,
    right: [<Battery key="battery" />, ...DEFAULT_BAR.right],
  },
});`;

/** How far a person takes manganese, from using it to replacing it. */
const STEPS: readonly { title: string; body: string }[] = [
  {
    body: "Pick it at login. The bar, launcher, notifications, lock screen and settings come with it.",
    title: "Use it",
  },
  {
    body: "Add a battery to the bar, or swap in your own launcher. Keep everything else.",
    title: "Change a piece",
  },
  {
    body: "Take the pieces you like into a shell of your own, or start fresh.",
    title: "Make your own",
  },
];

/** Points shell authors at manganese, in manganese's color. */
export const ReferenceShell = () => (
  <Section id="manganese">
    <Accent product="manganese">
      <div className={bandStyles}>
        <h2 className={titleStyles}>
          Don't start from zero. Start from manganese.
        </h2>
        <p className={bodyStyles}>
          Domicile is the compositor. A shell draws everything else. Manganese
          is a complete tiling shell built on Domicile: you don't have to build
          anything to use it, and every part of it is a package.
        </p>
        <ol className={stepsStyles}>
          {STEPS.map((step, at) => (
            <li className={stepStyles} key={step.title}>
              <span className={stepTitleStyles}>
                {`${at + 1}. ${step.title}`}
              </span>
              <span className={bodyStyles}>{step.body}</span>
            </li>
          ))}
        </ol>
        <CodeBlock code={SHELL} language="tsx" />
        <div className={actionsStyles}>
          <LinkButton href="/manganese">Meet manganese</LinkButton>
          <LinkButton href="/docs/shells/from-manganese" variant="outline">
            Composing its packages
          </LinkButton>
        </div>
      </div>
    </Accent>
  </Section>
);

const bandStyles = flex({
  backgroundColor:
    "color-mix(in oklab, {colors.accent} 6%, {colors.background})",
  border: "1px solid color-mix(in oklab, {colors.accent} 30%, {colors.border})",
  borderRadius: "3xl",
  direction: "column",
  gap: 4,
  padding: { base: 6, md: 10 },
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "3xl", md: "4xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
});

const bodyStyles = css({ color: "muted", maxInlineSize: "3xl" });

const stepsStyles = grid({
  gap: 3,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
  listStyle: "none",
});

const stepStyles = flex({
  backgroundColor: "color-mix(in oklab, {colors.accent} 4%, {colors.card})",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 1,
  padding: 4,
});

const stepTitleStyles = css({
  color: "accent",
  fontFamily: "display",
  fontWeight: "bold",
});

const actionsStyles = flex({ gap: 3, paddingBlockStart: 1, wrap: "wrap" });
