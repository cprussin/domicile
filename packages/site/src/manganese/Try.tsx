import { readFileSync } from "node:fs";
import { join } from "node:path";

import { flex } from "../../styled-system/patterns";
import { Markdown } from "../docs/Markdown";
import { PAGES, REPO_ROOT } from "../docs/pages";
import { LinkButton } from "../page/LinkButton";
import { Section } from "../page/Section";

const GUIDE = "docs/use/INSTALL.md";

/** The install guide's "Try it first" section, without its heading. */
const TRY = (() => {
  const guide = readFileSync(join(REPO_ROOT, GUIDE), "utf8");
  const start = guide.indexOf("## Try it first\n");
  if (start === -1) {
    throw new Error(`no "Try it first" section in ${GUIDE}`);
  }
  const body = guide.slice(guide.indexOf("\n", start) + 1);
  const end = body.indexOf("\n## ");
  return end === -1 ? body : body.slice(0, end);
})();

/** The invitation after the tour: try it in a window, or install it. */
export const Try = () => (
  <Section
    id="try"
    lede="Run it in a window on the desktop you have now. Close the window and you're back."
    title="Try it in a window"
  >
    <div className={bandStyles}>
      <Markdown from={GUIDE} pages={PAGES} source={TRY} />
      <div className={actionsStyles}>
        <LinkButton href="#install" size="lg">
          Install manganese
        </LinkButton>
        <LinkButton
          href="/docs/manganese/first-steps"
          size="lg"
          variant="outline"
        >
          First steps
        </LinkButton>
      </div>
    </div>
  </Section>
);

const bandStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  gap: 5,
  padding: { base: 6, md: 8 },
});

const actionsStyles = flex({ gap: 3, wrap: "wrap" });
