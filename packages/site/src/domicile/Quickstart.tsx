import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { DocTabs } from "../docs/DocTabs";
import { REPO_ROOT } from "../docs/pages";
import { Media } from "../media/Media";
import { Eyebrow } from "../page/Eyebrow";
import { Section } from "../page/Section";

// Above `STEPS`, which uses them as the module loads.
const linkStyles = css({ color: "foreground", textDecoration: "underline" });

type Step = {
  title: string;
  code: string;
  language: Language;
  note?: ReactNode;
};

/** The steps, with the shell in `file`, written as `example`. */
const steps = (file: string, example: string): readonly Step[] => [
  {
    code: "sudo apt install domicile",
    language: "bash",
    note: (
      <>
        Or dnf, zypper, the AUR or Nix. See{" "}
        <a className={linkStyles} href="/docs/manganese/install">
          Install
        </a>
        .
      </>
    ),
    title: "Install Domicile",
  },
  {
    code: readFileSync(join(REPO_ROOT, "examples", example), "utf8"),
    language: "tsx",
    note: "Each window is an <app> element. Put it where the window goes.",
    title: `Write ${file}`,
  },
  {
    code: `domicile ./${file}`,
    language: "bash",
    note: "Domicile builds it. No project needed.",
    title: "Run it",
  },
  {
    code: `domicile load-shell ./${file}`,
    language: "bash",
    note: (
      <>
        After an edit. Windows stay open.{" "}
        <a className={linkStyles} href="/docs/shells/quickstart">
          The whole guide
        </a>
        .
      </>
    ),
    title: "Change it",
  },
];

/** From nothing to a running shell. */
export const Quickstart = () => (
  <Section id="quickstart" title="A shell in five minutes">
    <div className={layoutStyles}>
      <div className={stepsStyles}>
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
      <div className={mediaStyles}>
        <Media
          alt="The four steps, then a CSS edit and domicile load-shell"
          name="quickstart"
        />
      </div>
    </div>
  </Section>
);

/** The numbered steps. */
const Steps = ({ steps }: { steps: readonly Step[] }) => (
  <ol className={listStyles}>
    {steps.map((step, at) => (
      <li className={stepStyles} key={step.title}>
        <Eyebrow>{`${String(at + 1).padStart(2, "0")} · ${step.title}`}</Eyebrow>
        <CodeBlock code={step.code} language={step.language} />
        {step.note === undefined ? undefined : (
          <span className={noteStyles}>{step.note}</span>
        )}
      </li>
    ))}
  </ol>
);

const layoutStyles = flex({ gap: 5, marginBlockStart: 6, wrap: "wrap" });

const stepsStyles = css({ flex: "1 1 23.75rem", minInlineSize: 0 });

const listStyles = flex({ direction: "column", gap: 4, listStyle: "none" });

const stepStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2.5,
  padding: 5,
});

const noteStyles = css({ color: "muted", fontSize: "sm" });

const mediaStyles = css({ flex: "999 1 28.75rem", minInlineSize: 0 });
