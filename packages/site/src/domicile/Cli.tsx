import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Eyebrow } from "../page/Eyebrow";
import { IconTile } from "../page/IconTile";
import { Section } from "../page/Section";

const RELOAD = `# rebuild, then swap the new build in
bun run build
domicile load-shell ./dist/shell.js

# or switch shells without logging out
domicile load-shell @domicile-desktop/manganese`;

const COMMANDS = `# open a browser window, or a site as an app
domicile open-url <url>
domicile open-app <url>

# run one of your shell's commands
domicile send-shell <word>…

# switch between light and dark
domicile theme toggle

# write a PNG of the desktop
domicile screenshot <file>`;

/** The commands the running desktop takes, led by `load-shell`. */
export const Cli = () => (
  <Section
    id="cli"
    lede="The running desktop takes commands from your terminal, like swaymsg does for sway."
    title="Drive it from the command line"
  >
    <div className={layoutStyles}>
      <div className={cardStyles}>
        <div className={labelStyles}>
          <IconTile>
            <ArrowsClockwiseIcon />
          </IconTile>
          <Eyebrow>Hot reload</Eyebrow>
        </div>
        <h3 className={titleStyles}>domicile load-shell</h3>
        <p className={bodyStyles}>
          Replace the running shell with a new build, or a different shell.
          Windows stay open, and nothing restarts.
        </p>
        <CodeBlock code={RELOAD} language="bash" />
      </div>
      <div className={cardStyles}>
        <Eyebrow>And the rest</Eyebrow>
        <CodeBlock code={COMMANDS} language="bash" />
      </div>
    </div>
  </Section>
);

const layoutStyles = flex({ gap: 4, wrap: "wrap" });

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  flex: "1 1 23.75rem",
  gap: 3,
  minInlineSize: 0,
  padding: 6,
});

const labelStyles = hstack({ gap: 3 });

const titleStyles = css({
  fontFamily: "code",
  fontSize: "xl",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted" });
