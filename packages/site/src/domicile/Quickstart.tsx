import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Media } from "../media/Media";
import { Eyebrow } from "../page/Eyebrow";
import { Section } from "../page/Section";

// Above `STEPS`, which uses them as the module loads.
const linkStyles = css({ color: "foreground", textDecoration: "underline" });

const codeStyles = css({ fontFamily: "code" });

const STEPS: readonly { title: string; code: string; note?: ReactNode }[] = [
  {
    code: "sudo apt install domicile",
    note: (
      <>
        Or dnf, zypper, the AUR or Nix. See{" "}
        <a className={linkStyles} href="/manganese#install">
          Install
        </a>
        .
      </>
    ),
    title: "Install Domicile",
  },
  {
    code: "git clone https://github.com/cprussin/domicile\ncp -r domicile/examples/minimal-shell my-shell",
    title: "Copy the example",
  },
  {
    code: "cd my-shell && bun install && bun run build",
    title: "Build it",
  },
  {
    code: "domicile ./.vite/renderer/main_window/shell.js",
    note: (
      <>
        It opens in a window on your current desktop. Rebuild, then{" "}
        <a className={linkStyles} href="#cli">
          <code className={codeStyles}>domicile load-shell</code>
        </a>{" "}
        it.
      </>
    ),
    title: "Run it",
  },
];

/** From nothing to a running shell. */
export const Quickstart = () => (
  <Section id="quickstart" title="A shell in five minutes">
    <div className={layoutStyles}>
      <ol className={stepsStyles}>
        {STEPS.map((step, at) => (
          <li className={stepStyles} key={step.title}>
            <Eyebrow>{`${String(at + 1).padStart(2, "0")} · ${step.title}`}</Eyebrow>
            <CodeBlock code={step.code} language="bash" />
            {step.note === undefined ? undefined : (
              <span className={noteStyles}>{step.note}</span>
            )}
          </li>
        ))}
      </ol>
      <div className={mediaStyles}>
        <Media
          alt="The four steps, then a CSS edit and domicile load-shell"
          name="quickstart"
        />
      </div>
    </div>
  </Section>
);

const layoutStyles = flex({ gap: 5, marginBlockStart: 6, wrap: "wrap" });

const stepsStyles = flex({
  direction: "column",
  flex: "1 1 23.75rem",
  gap: 4,
  listStyle: "none",
  minInlineSize: 0,
});

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
