import { readFileSync } from "node:fs";
import { join } from "node:path";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Markdown } from "../docs/Markdown";
import { PAGES, REPO_ROOT } from "../docs/pages";
import { Section } from "../page/Section";

const GUIDE = "docs/use/INSTALL.md";

const guide = readFileSync(join(REPO_ROOT, GUIDE), "utf8");

/** The section of the install guide under `heading`, without the heading. */
const sectionOf = (heading: string): string => {
  const start = guide.indexOf(`## ${heading}\n`);
  if (start === -1) {
    throw new Error(`no "${heading}" section in ${GUIDE}`);
  }
  const body = guide.slice(guide.indexOf("\n", start) + 1);
  const end = body.indexOf("\n## ");
  return end === -1 ? body : body.slice(0, end);
};

/** The install guide's package manager tabs, so the two can't drift. */
const TABS = guide.slice(
  guide.indexOf("<!-- tab: "),
  guide.indexOf("<!-- /tabs -->"),
);

const AFTER = sectionOf("After installing");

/** How to install, per distribution. */
export const Install = () => (
  <Section
    id="install"
    lede="Install it from your package manager, then log in to the Domicile session."
    title="Install"
  >
    <div className={panelStyles}>
      <Markdown from={GUIDE} pages={PAGES} source={TABS} />
      <h3 className={stepStyles}>After installing</h3>
      <Markdown from={GUIDE} pages={PAGES} source={AFTER} />
      <a className={linkStyles} href="/docs/manganese/install">
        Full install guide →
      </a>
    </div>
  </Section>
);

const panelStyles = flex({ direction: "column", gap: 4 });

const stepStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const linkStyles = css({
  color: "accent",
  fontSize: "sm",
  fontWeight: "semibold",
});
