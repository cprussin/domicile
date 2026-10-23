import { Kbd } from "@domicile-desktop/component-library/Kbd";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

// manganese's defaults, from
// packages/manganese-window-management/docs/KEYS.md.
const KEYS: readonly { combo: readonly string[]; does: string }[] = [
  { combo: ["Meta", "Space"], does: "Open the launcher" },
  { combo: ["Meta", "H J K L"], does: "Move focus" },
  { combo: ["Meta", "1 … 0"], does: "Go to workspace 1–10" },
  { combo: ["Meta", "B / V"], does: "Split horizontally / vertically" },
  { combo: ["Meta", "W"], does: "Tab the container" },
  { combo: ["Meta", "F"], does: "Fullscreen" },
  { combo: ["Meta", "Shift", "V"], does: "Clipboard history" },
  { combo: ["Meta", "Shift", "Q"], does: "Close the window" },
];

/** The keys a Sway user reaches for first. */
export const Keys = () => (
  <Section id="keys">
    <div className={headStyles}>
      <div>
        <h2 className={titleStyles}>Your fingers already know it</h2>
        <p className={ledeStyles}>Sway's keys, on Meta. Rebind any of them.</p>
      </div>
      <a
        className={linkStyles}
        href={repoFile("packages/manganese-window-management/docs/KEYS.md")}
      >
        The full cheat sheet →
      </a>
    </div>
    <div className={gridStyles}>
      {KEYS.map((key) => (
        <div className={cardStyles} key={key.does}>
          <div className={comboStyles}>
            {key.combo.map((part) => (
              <Kbd key={part}>{part}</Kbd>
            ))}
          </div>
          <span className={doesStyles}>{key.does}</span>
        </div>
      ))}
    </div>
  </Section>
);

const headStyles = flex({
  align: "flex-end",
  gap: 4,
  justify: "space-between",
  marginBlockEnd: 7,
  wrap: "wrap",
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: { base: "3xl", md: "5xl" },
  fontWeight: "bold",
  letterSpacing: "tight",
  lineHeight: "tight",
  marginBlockEnd: 2,
});

const ledeStyles = css({ color: "muted", fontSize: "lg" });

const linkStyles = css({ color: "accent", fontWeight: "semibold" });

const gridStyles = grid({ gap: 3, minChildWidth: "16.25rem" });

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2.5,
  paddingBlock: 4,
  paddingInline: 4.5,
});

const comboStyles = flex({ fontSize: "lg", gap: 1.5, wrap: "wrap" });

const doesStyles = css({ color: "muted", fontSize: "sm" });
