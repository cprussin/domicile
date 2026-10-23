import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Accent } from "../page/Accent";
import { Eyebrow } from "../page/Eyebrow";
import { LinkButton } from "../page/LinkButton";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

const SHELL = `import { runManganese, DEFAULT_BAR } from "@domicile-desktop/manganese";
import { Weather } from "./weather";

export const Shell = runManganese({
  bar: { ...DEFAULT_BAR, right: [Weather, ...DEFAULT_BAR.right] },
  floating: [{ app: "pinentry" }],
});`;

/** Points shell authors at manganese, in manganese's color. */
export const ReferenceShell = () => (
  <Section id="manganese">
    <Accent product="manganese">
      <div className={bandStyles}>
        <div className={textStyles}>
          <Eyebrow>The reference shell</Eyebrow>
          <h2 className={titleStyles}>
            Don't start from zero. Start from manganese.
          </h2>
          <p className={bodyStyles}>
            Manganese is a full tiling desktop built on Domicile, and every part
            of it is a package you can use. Keep its window manager and swap the
            bar, or take its launcher into a shell of your own.
          </p>
          <div className={actionsStyles}>
            <LinkButton href="/manganese">Meet manganese</LinkButton>
            <LinkButton
              href={repoFile("packages/shell-manganese/docs/SOURCE.md")}
              variant="outline"
            >
              Composing its packages
            </LinkButton>
          </div>
        </div>
        <div className={codeStyles}>
          <CodeBlock code={SHELL} language="tsx" />
        </div>
      </div>
    </Accent>
  </Section>
);

const bandStyles = flex({
  align: "center",
  backgroundColor:
    "color-mix(in oklab, {colors.accent} 6%, {colors.background})",
  border: "1px solid color-mix(in oklab, {colors.accent} 30%, {colors.border})",
  borderRadius: "3xl",
  gap: 8,
  padding: 10,
  wrap: "wrap",
});

const textStyles = flex({
  direction: "column",
  flex: "1 1 22.5rem",
  gap: 3.5,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "3xl", md: "4xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
});

const bodyStyles = css({ color: "muted" });

const actionsStyles = flex({ gap: 3, paddingBlockStart: 1, wrap: "wrap" });

const codeStyles = css({ flex: "999 1 28.75rem", minInlineSize: 0 });
