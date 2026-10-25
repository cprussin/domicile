import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Media } from "../media/Media";

// The shell in `packages/site/scripts/docs-media/scenes/hero/shell.js`, as a reader would
// write it, beside what it draws.
const SHELL = `// shell.tsx
const Shell = ({ windows: [left, right] }) => (
  <main>
    <app app-id={left.appId} />
    <section>
      <webview src="https://github.com/cprussin/domicile" />
      <app app-id={right.appId} />
    </section>
  </main>
);`;

const STYLES = `/* shell.css */
main {
  display: flex;
  gap: 10px;
}

section {
  display: flex;
  flex-direction: column;
}

app {
  border-radius: 12px;
}`;

/** The hero's code beside a capture of the desktop it draws. */
export const HeroMedia = () => (
  <section className={sectionStyles}>
    <div className={codeStyles}>
      <CodeBlock code={SHELL} frame="bare" language="tsx" />
      <CodeBlock code={STYLES} frame="bare" language="css" />
    </div>
    <div className={mediaStyles}>
      <Media
        alt="nvim on the left; GitHub over btop on the right, each window a page element"
        name="hero"
      />
    </div>
  </section>
);

const sectionStyles = flex({
  align: "stretch",
  gap: 5,
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 24,
  paddingBlockStart: 4,
  paddingInline: 6,
  wrap: "wrap",
});

const codeStyles = flex({
  backgroundColor: "syntax.ground",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  flex: "1 1 26rem",
  gap: 6,
  minInlineSize: 0,
  padding: 6,
});

const mediaStyles = css({ flex: "999 1 35rem", minInlineSize: 0 });
