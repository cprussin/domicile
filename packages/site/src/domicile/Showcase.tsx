import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { Section } from "../page/Section";

/** What a person would ask for, the code that does it, and what to know. */
const ASKS: readonly {
  ask: string;
  code: string;
  language: Language;
  note?: string;
}[] = [
  {
    ask: "Tile my windows.",
    code: "main {\n  display: flex;\n}",
    language: "css",
    note: "Your layout is a stylesheet. Floating is one more rule.",
  },
  {
    ask: "Blur every window except the one I'm typing in.",
    code: "app:not(.focused) {\n  filter: blur(6px) grayscale(1);\n}",
    language: "css",
  },
  {
    ask: "Pin my calendar to the desktop.",
    code: '<webview\n  src="https://calendar.google.com"\n  className="h-96 w-80"\n/>',
    language: "tsx",
    note: "Any website is an element you place, like a window.",
  },
  {
    ask: "Slide windows to the other screen when I switch workspaces.",
    code: "app {\n  transition: translate 0.4s;\n}",
    language: "css",
    note: "One page spans every monitor, so a window just moves.",
  },
  {
    ask: "Put my password manager in the bar.",
    code: '{\n  "extensions": {\n    "web_store": ["nngceckbapebfimnlniiiahkandclblb"]\n  }\n}',
    language: "json",
    note: "Bitwarden from the Chrome Web Store. It fills logins in every browser window, and your shell puts its button in your bar.",
  },
  {
    ask: "Run someone else's desktop in a window of mine.",
    code: 'import { Shell } from "@someone/their-desktop";\n\n<NestedShell shell={Shell} />',
    language: "tsx",
    note: "Desktops, bars and panels are npm packages. Use anyone's, or nest a whole desktop in yours.",
  },
];

/** Things a desktop can do once it's built with the web, each as an ask and its code. */
export const Showcase = () => (
  <Section
    id="only"
    lede="Say it to your coding agent, or write it yourself. Either way, it's a few lines."
    title="Things you can do when your desktop is built with the web."
  >
    <div className={gridStyles}>
      {ASKS.map(({ ask, code, language, note }) => (
        <div className={cardStyles} key={ask}>
          <p className={askStyles}>“{ask}”</p>
          <CodeBlock code={code} language={language} />
          {note === undefined ? undefined : (
            <p className={noteStyles}>{note}</p>
          )}
        </div>
      ))}
    </div>
  </Section>
);

const gridStyles = grid({
  gap: 4,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
});

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 3,
  minInlineSize: 0,
  padding: 5,
});

const askStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const noteStyles = css({ color: "muted", fontSize: "sm" });
