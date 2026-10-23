import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package";
import { PuzzlePieceIcon } from "@phosphor-icons/react/dist/ssr/PuzzlePiece";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { Eyebrow } from "../page/Eyebrow";
import { IconTile } from "../page/IconTile";
import { Section } from "../page/Section";

const PUBLISH = `# in your shell's package.json
#   "domicile": { "shell": "dist/shell.js" }
npm publish

# anyone, anywhere
domicile @you/my-desktop`;

// `@someone/domicile-weather` stands for any package someone publishes.
const MIX = `import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
import { Weather } from "@someone/domicile-weather";

export const Bar = () => (
  <header>
    <Weather city="Portland" />
    <Clock />
  </header>
);`;

/** Shells and their parts are npm packages. */
export const Npm = () => (
  <Section
    id="npm"
    lede="A shell is an npm package, and so is every piece of one. Publish your whole desktop, or just the bar you're proud of, and build on what other people have published."
    title="Share it on npm"
  >
    <div className={cardsStyles}>
      <Card
        code={PUBLISH}
        icon={<PackageIcon />}
        label="Your whole desktop"
        language="bash"
        title="Publish your desktop"
      >
        Anyone can run it by name. Domicile fetches and builds it on first
        start, and caches it after that.
      </Card>
      <Card
        code={MIX}
        icon={<PuzzlePieceIcon />}
        label="Pieces of it"
        language="tsx"
        title="Mix and match components"
      >
        Bars, launchers, lock screens and bar items are ordinary React
        components. Import manganese's, or anyone else's.
      </Card>
    </div>
  </Section>
);

type CardProps = {
  icon: ReactNode;
  label: string;
  title: string;
  children: ReactNode;
  code: string;
  language: Language;
};

const Card = ({ icon, label, title, children, code, language }: CardProps) => (
  <div className={cardStyles}>
    <div className={labelStyles}>
      <IconTile>{icon}</IconTile>
      <Eyebrow>{label}</Eyebrow>
    </div>
    <h3 className={titleStyles}>{title}</h3>
    <p className={bodyStyles}>{children}</p>
    <CodeBlock code={code} language={language} />
  </div>
);

const cardsStyles = flex({ gap: 5, wrap: "wrap" });

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  flex: "1 1 27.5rem",
  gap: 3.5,
  minInlineSize: 0,
  padding: 7,
});

const labelStyles = hstack({ gap: 3 });

const titleStyles = css({
  fontFamily: "display",
  fontSize: "2xl",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted" });
