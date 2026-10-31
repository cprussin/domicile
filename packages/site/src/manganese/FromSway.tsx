import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { Section } from "../page/Section";

type Column = {
  title: string;
  items: readonly { text: string; code?: string }[];
};

// Each checked against manganese's DEFAULT_KEYBINDINGS
// (packages/manganese-window-management/src/keyboard/commands.ts) and
// docs/use/KEYS.md.
const COLUMNS: readonly Column[] = [
  {
    items: [
      { text: "Splits, tabs, stacks, floating and the scratchpad" },
      { text: "Ten workspaces on Meta+1 … Meta+0" },
      { text: "Meta+H/J/K/L to focus, with Shift to move" },
      { text: "Focus follows the pointer" },
      {
        code: "layout toggle split",
        text: "Sway's command names, and modes, in your keybindings:",
      },
    ],
    title: "Feels the same",
  },
  {
    items: [
      {
        text: "Meta+Space opens the launcher. Meta+Tab switches between floating and tiled",
      },
      {
        text: "Meta+Shift+Tab floats a window, and nothing is on Meta+Return until you bind it",
      },
      {
        text: "No sway config file. Settings live in domicile.json, and keys in a domicile.tsx config module",
      },
      {
        code: "domicile send-shell workspace 2",
        text: "Commands from a terminal:",
      },
      { text: "Wayland apps only: there's no Xwayland" },
    ],
    title: "Works differently",
  },
];

const START: readonly { href: string; label: string }[] = [
  { href: "/docs/manganese/keys", label: "Every key" },
  { href: "/docs/manganese/keys#add-your-own", label: "Bind your own keys" },
  { href: "/docs/manganese/windows", label: "Windows and workspaces" },
  { href: "/docs/manganese/settings", label: "The config file" },
];

/** What a Sway user keeps, what changes, and where to start. */
export const FromSway = () => (
  <Section
    id="sway"
    lede="The layout and the keys will feel familiar. Your sway config won't carry over."
    title="Coming from Sway?"
  >
    <div className={gridStyles}>
      {COLUMNS.map((column) => (
        <div className={cardStyles} key={column.title}>
          <h3 className={titleStyles}>{column.title}</h3>
          <ul className={listStyles}>
            {column.items.map((item) => (
              <li key={item.text}>
                {item.text}
                {item.code === undefined ? undefined : (
                  <>
                    {" "}
                    <code className={codeStyles}>{item.code}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className={cardStyles}>
        <h3 className={titleStyles}>Start here</h3>
        <ul className={listStyles}>
          {START.map((link) => (
            <li key={link.href}>
              <a className={linkStyles} href={link.href}>
                {link.label} →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </Section>
);

const gridStyles = grid({
  gap: 4,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))",
});

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 3,
  padding: 6,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const listStyles = flex({
  color: "muted",
  direction: "column",
  fontSize: "sm",
  gap: 2.5,
  listStyle: "none",
});

const codeStyles = css({
  color: "foreground",
  fontFamily: "mono",
  fontSize: "xs",
});

const linkStyles = css({ color: "accent", fontWeight: "semibold" });
