import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Section } from "../page/Section";

/** Three window layouts, each one rule of CSS. */
export const CssStrip = () => (
  <Section
    id="css"
    lede="Want floating? Use CSS. Want to rotate kitty 17 degrees because the user has sinned? Unfortunately, use CSS."
    title="Want tiling? Use CSS."
  >
    <div className={gridStyles}>
      <Layout code={"main {\n  display: flex;\n}"}>
        <div className={tiledStyles}>
          <span className={focusedStyles} />
          <span className={columnStyles}>
            <span className={otherStyles} />
            <span className={otherStyles} />
          </span>
        </div>
      </Layout>
      <Layout code={"app.floating {\n  position: absolute;\n}"}>
        <div className={floatingStyles}>
          <span className={behindStyles} />
          <span className={floatedStyles} />
        </div>
      </Layout>
      <Layout code={"app {\n  transform: rotate(17deg);\n}"}>
        <div className={rotatedGroundStyles}>
          <span className={rotatedStyles}>kitty</span>
        </div>
      </Layout>
    </div>
  </Section>
);

/** A picture of a layout over the CSS that makes it. */
const Layout = ({ code, children }: { code: string; children: ReactNode }) => (
  <div className={cardStyles}>
    <div className={pictureStyles}>{children}</div>
    <CodeBlock code={code} frame="bare" language="css" />
  </div>
);

const gridStyles = grid({ gap: 5, minChildWidth: "17.5rem" });

const cardStyles = css({
  "& pre": { paddingBlock: 4, paddingInline: 5 },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  overflow: "hidden",
});

const pictureStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.card} 60%, {colors.background})",
  blockSize: 40,
  position: "relative",
});

const tiledStyles = flex({ blockSize: "100%", gap: 2, padding: 5 });

const focusedStyles = css({
  backgroundColor: "syntax.ground",
  border: "2px solid {colors.accent}",
  borderRadius: "md",
  flex: 1,
});

const otherStyles = css({
  backgroundColor: "borderStrong",
  borderRadius: "md",
  flex: 1,
});

const columnStyles = flex({ direction: "column", flex: 1, gap: 2 });

const floatingStyles = css({ blockSize: "100%", position: "relative" });

const behindStyles = css({
  backgroundColor: "borderStrong",
  blockSize: "60%",
  borderRadius: "md",
  inlineSize: "46%",
  insetBlockStart: 7,
  insetInlineStart: 6,
  position: "absolute",
});

const floatedStyles = css({
  backgroundColor: "syntax.ground",
  blockSize: "56%",
  border: "2px solid {colors.accent}",
  borderRadius: "md",
  boxShadow: "lifted",
  inlineSize: "42%",
  insetBlockStart: 12,
  insetInlineEnd: 7,
  position: "absolute",
});

const rotatedGroundStyles = flex({
  align: "center",
  blockSize: "100%",
  justify: "center",
});

const rotatedStyles = flex({
  align: "center",
  backgroundColor: "syntax.ground",
  blockSize: "58%",
  border: "2px solid {colors.accent}",
  borderRadius: "xl",
  color: "muted",
  fontSize: "xs",
  fontWeight: "semibold",
  inlineSize: "44%",
  justify: "center",
  transform: "rotate(17deg)",
});
