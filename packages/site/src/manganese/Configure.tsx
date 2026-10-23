import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { Media } from "../media/Media";
import { Tabs } from "../page/Tabs";

const CONFIG = `// ~/.config/domicile/domicile.json
{
  "shell": "@domicile-desktop/manganese",
  "shell_options": {
    "clock": { "format": "12h", "seconds": false }
  }
}`;

/** The Settings app and the config file, side by side. */
export const Configure = () => (
  <section className={sectionStyles} id="configure">
    <div className={bandStyles}>
      <div className={textStyles}>
        <h2 className={titleStyles}>Configure it your way</h2>
        <p className={bodyStyles}>
          Click through the Settings app or write a config file. They change the
          same things, and every page in the docs shows both.
        </p>
      </div>
      <div className={tabsStyles}>
        <Tabs
          aria-label="Configure with"
          defaultValue="settings"
          tabs={[
            {
              content: (
                <div className={panelStyles}>
                  <Media
                    alt="The Settings app's Shell page with the clock set to 12h"
                    name="configure-settings"
                    shape="wide"
                  />
                </div>
              ),
              label: "Settings app",
              value: "settings",
            },
            {
              content: (
                <div className={panelStyles}>
                  {/* JSON with a comment, which highlight.js rejects. */}
                  <CodeBlock code={CONFIG} language="plain" />
                </div>
              ),
              label: "Config file",
              value: "file",
            },
          ]}
        />
      </div>
    </div>
  </section>
);

const sectionStyles = css({
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlockEnd: 28,
  paddingInline: 6,
  scrollMarginBlockStart: 6,
});

const bandStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  gap: 7,
  padding: 8,
  wrap: "wrap",
});

const textStyles = flex({ direction: "column", flex: "1 1 18.75rem", gap: 3 });

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "3xl", md: "4xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
});

const bodyStyles = css({ color: "muted" });

const tabsStyles = css({ flex: "999 1 26.25rem", minInlineSize: 0 });

const panelStyles = css({ marginBlockStart: 4 });
