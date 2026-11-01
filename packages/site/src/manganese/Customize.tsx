import { readFileSync } from "node:fs";
import { join } from "node:path";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { REPO_ROOT } from "../docs/pages";
import { Media } from "../media/Media";
import { Section } from "../page/Section";
import { Tabs } from "../page/Tabs";

/** The example the `manganese-bar-item` capture runs. */
const EXAMPLE = "examples/manganese-bar-item";

const read = (file: string): string =>
  readFileSync(join(REPO_ROOT, EXAMPLE, file), "utf8").trimEnd();

/** One bar item of your own, on all of manganese, and what it looks like. */
export const Customize = () => (
  <Section
    id="customize"
    lede="Keep all of manganese and add what you're missing. This bar item is a React component and a CSS file. Everything else stays as it was."
    title="Make it yours, a piece at a time"
  >
    <div className={layoutStyles}>
      <div className={codeStyles}>
        <Tabs
          aria-label="File"
          defaultValue="tsx"
          tabs={[
            {
              content: (
                <div className={panelStyles}>
                  <CodeBlock code={read("domicile.tsx")} language="tsx" />
                </div>
              ),
              label: "domicile.tsx",
              value: "tsx",
            },
            {
              content: (
                <div className={panelStyles}>
                  <CodeBlock code={read("tokyo.css")} language="css" />
                </div>
              ),
              label: "tokyo.css",
              value: "css",
            },
          ]}
        />
      </div>
      <div className={resultStyles}>
        <Media
          alt="Manganese's top bar with the time in Tokyo beside the clock, over a document and a browser window"
          name="manganese-bar-item"
        />
        <CodeBlock code="domicile ./domicile.tsx" language="bash" />
        <p className={noteStyles}>
          Try it in a window. To keep it, make it your{" "}
          <a
            className={linkStyles}
            href="/docs/manganese/settings#a-config-module"
          >
            config module
          </a>
          .
        </p>
        <div className={linksStyles}>
          <a
            className={nextStyles}
            href="/docs/manganese/top-bar#change-what-it-shows"
          >
            Change the top bar →
          </a>
          <a className={nextStyles} href="/docs/shells/from-manganese">
            Swap the launcher, keys and more →
          </a>
        </div>
      </div>
    </div>
  </Section>
);

// The code gets the wider column: its longest line is the import.
const layoutStyles = grid({
  alignItems: "start",
  gap: 6,
  gridTemplateColumns: { base: "minmax(0, 1fr)", lg: "3fr 2fr" },
});

const codeStyles = css({ minInlineSize: 0 });

const panelStyles = css({ marginBlockStart: 4 });

const resultStyles = flex({ direction: "column", gap: 3, minInlineSize: 0 });

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({ color: "foreground", textDecoration: "underline" });

const linksStyles = flex({ gap: 5, wrap: "wrap" });

const nextStyles = css({
  color: "accent",
  fontSize: "sm",
  fontWeight: "semibold",
});
