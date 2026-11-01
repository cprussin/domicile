import { readFileSync } from "node:fs";
import { join } from "node:path";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { REPO_ROOT } from "../docs/pages";
import { Media } from "../media/Media";
import { Section } from "../page/Section";

const SCENE = "packages/site/scripts/docs-media/scenes/live-swap";

/** The layout rule a shell of the `live-swap` scene passes, as the recording runs it. */
const ruleOf = (shell: string): string => {
  const rule = /"(main \{[^"]+\})"/.exec(
    readFileSync(join(REPO_ROOT, SCENE, shell), "utf8"),
  )?.[1];
  if (rule === undefined) {
    throw new Error(`no layout rule in ${SCENE}/${shell}`);
  }
  return rule;
};

const CHANGE = `/* before */
${ruleOf("side-by-side.js")}

/* after */
${ruleOf("stacked.js")}`;

/** Replacing the running shell while every window stays open. */
export const Swap = () => (
  <Section
    id="swap"
    lede="Change your code and run one command. The new shell takes over, and every window stays open. The race doesn't even stop. A build that fails keeps the shell you had."
    title="Swap the shell. Keep your windows."
  >
    <div className={layoutStyles}>
      <Media
        alt="A race and a terminal aquarium side by side. domicile load-shell swaps in a shell that stacks them, and both keep going."
        name="live-swap"
      />
      <div className={codeStyles}>
        <CodeBlock code={CHANGE} language="css" />
        <div className={commandStyles}>
          <CodeBlock code="domicile load-shell ./stacked.js" language="bash" />
          <p className={noteStyles}>
            The shell's own page starts over, so state it kept there is lost.{" "}
            <a
              className={linkStyles}
              href="/docs/reference/cli#domicile-load-shell-shell"
            >
              load-shell
            </a>
          </p>
        </div>
      </div>
    </div>
  </Section>
);

const layoutStyles = flex({ direction: "column", gap: 4 });

const codeStyles = grid({
  alignItems: "start",
  gap: 4,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
});

const commandStyles = flex({ direction: "column", gap: 3 });

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({ color: "foreground", textDecoration: "underline" });
