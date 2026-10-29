import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { DocTabs } from "../docs/DocTabs";
import { Media } from "../media/Media";

// The shell in `packages/site/scripts/docs-media/scenes/hero/shell.js`, as a reader would
// write it, beside what it draws.
const SHELL = `// shell.tsx
const Desktop = () => {
  const [left, right] = useWindows();
  return (
    <main>
      <app app-id={left?.appId} />
      <section>
        <webview src="https://github.com/cprussin/domicile" />
        <app app-id={right?.appId} />
      </section>
    </main>
  );
};

export const Shell = mount(Desktop);`;

const VANILLA_SHELL = `// shell.js
export const Shell = (root, domicile) => {
  root.innerHTML = \`<main>
    <app></app>
    <section>
      <webview src="https://github.com/cprussin/domicile"></webview>
      <app></app>
    </section>
  </main>\`;
  const apps = root.querySelectorAll("app");
  domicile.windows.on("change", () => {
    domicile.windows.list.forEach((w, at) =>
      apps[at]?.setAttribute("app-id", w.appId),
    );
  });
};`;

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

/**
 * The hero's code over a capture of the desktop it draws: the shell and its
 * stylesheet side by side, each wide enough for its longest line.
 */
export const HeroMedia = () => (
  <section className={sectionStyles}>
    <div className={codeStyles}>
      <DocTabs
        tabs={[
          {
            content: <CodeBlock code={SHELL} frame="bare" language="tsx" />,
            label: "React",
          },
          {
            content: (
              <CodeBlock code={VANILLA_SHELL} frame="bare" language="tsx" />
            ),
            label: "JavaScript",
          },
        ]}
      />
      <div className={stylesStyles}>
        <CodeBlock code={STYLES} frame="bare" language="css" />
      </div>
    </div>
    <Media
      alt="SuperTuxKart racing on the left; GitHub over Big Buck Bunny on the right, each window a page element"
      name="hero"
    />
  </section>
);

const sectionStyles = flex({
  direction: "column",
  gap: 5,
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 24,
  paddingBlockStart: 4,
  paddingInline: 6,
});

// Side by side once the shell's longest line fits beside the stylesheet.
const codeStyles = grid({
  backgroundColor: "syntax.ground",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  columnGap: 10,
  gridTemplateColumns: { base: "minmax(0, 1fr)", lg: "minmax(0, 1fr) auto" },
  padding: 6,
  rowGap: 6,
});

// Its first line level with the shell's, below the shell's tab bar.
const stylesStyles = css({ paddingBlockStart: { base: 0, lg: "3.0625rem" } });
