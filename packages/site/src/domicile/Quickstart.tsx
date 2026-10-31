import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { DocTabs } from "../docs/DocTabs";
import { Markdown } from "../docs/Markdown";
import { PAGES, REPO_ROOT } from "../docs/pages";
import { Section } from "../page/Section";

// Above `STEPS`, which uses them as the module loads.
const linkStyles = css({ color: "foreground", textDecoration: "underline" });

type Step = {
  title: string;
  code: string;
  language: Language;
  note?: ReactNode;
};

/** The install guide's package manager tabs, Debian through NixOS. */
const INSTALL = (() => {
  const guide = readFileSync(join(REPO_ROOT, "docs", "INSTALL.md"), "utf8");
  return guide.slice(
    guide.indexOf("<!-- tab: "),
    guide.indexOf("<!-- /tabs -->"),
  );
})();

/** The steps after installing, with the shell in `file`, written as `example`. */
const steps = (file: string, example: string): readonly Step[] => [
  {
    code: readFileSync(join(REPO_ROOT, "examples", example), "utf8"),
    language: "tsx",
    note: "Each window is an <app> element. Put it where the window goes.",
    title: `Write ${file}`,
  },
  {
    code: `domicile ./${file}`,
    language: "bash",
    note: "It opens in a window on your current desktop. Domicile builds it, with no project needed.",
    title: "Run it",
  },
  {
    code: `domicile load-shell ./${file}`,
    language: "bash",
    note: "After an edit. Windows stay open.",
    title: "Change it",
  },
  {
    code: `{ "shell": "./${file}" }`,
    language: "json",
    note: (
      <>
        Move {file} to ~/.config/domicile/, name it in
        ~/.config/domicile/domicile.json, then log out and pick Domicile. No
        account, no AI, and all of Domicile is MIT licensed.{" "}
        <a className={linkStyles} href="/docs/shells/quickstart">
          The whole guide
        </a>
        .
      </>
    ),
    title: "Make it your desktop",
  },
];

/**
 * From nothing to a running shell: the steps, wide enough for the shell's
 * longest line.
 */
export const Quickstart = () => (
  <Section id="quickstart" title="A shell in five minutes">
    <div className={layoutStyles}>
      <div className={stepStyles}>
        <h3 className={stepTitleStyles}>1. Install Domicile</h3>
        <Markdown from="docs/INSTALL.md" pages={PAGES} source={INSTALL} />
      </div>
      <DocTabs
        tabs={[
          {
            content: (
              <Steps steps={steps("shell.tsx", "react-shell/shell.tsx")} />
            ),
            label: "React",
          },
          {
            content: (
              <Steps steps={steps("shell.js", "vanilla-shell/shell.js")} />
            ),
            label: "JavaScript",
          },
        ]}
      />
    </div>
  </Section>
);

/** The numbered steps. */
const Steps = ({ steps }: { steps: readonly Step[] }) => (
  <ol className={listStyles}>
    {steps.map((step, at) => (
      <li className={stepStyles} key={step.title}>
        <h3 className={stepTitleStyles}>{`${at + 2}. ${step.title}`}</h3>
        <CodeBlock code={step.code} language={step.language} />
        {step.note === undefined ? undefined : (
          <span className={noteStyles}>{step.note}</span>
        )}
      </li>
    ))}
  </ol>
);

const layoutStyles = flex({
  direction: "column",
  gap: 5,
  marginBlockStart: 6,
});

const listStyles = flex({ direction: "column", gap: 4, listStyle: "none" });

const stepStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2.5,
  padding: 5,
});

const stepTitleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const noteStyles = css({ color: "muted", fontSize: "sm" });
