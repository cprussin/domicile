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
    ask: "Make the bar thinner.",
    code: "# save shell.tsx, then\ndomicile load-shell ./shell.tsx",
    language: "bash",
    note: "Every window stays open, and a video keeps playing. A build that fails keeps the shell you had.",
  },
  {
    ask: "Blur every window except the one I'm typing in.",
    code: "app:not(.focused) {\n  filter: blur(6px) grayscale(1);\n}",
    language: "css",
  },
  {
    ask: "Put my texts in the notification drawer.",
    code: "runManganese({\n  inboxes: [messagesInbox()],\n});",
    language: "tsx",
    note: "Google Messages for web, as a part of your desktop.",
  },
  {
    ask: "Slide windows to the other screen when I switch workspaces.",
    code: "app {\n  transition: translate 0.4s;\n}",
    language: "css",
    note: "One page spans every monitor, so a window just moves.",
  },
  {
    ask: "Block ads in every app, not just the browser.",
    code: '{\n  "extensions": {\n    "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"]\n  }\n}',
    language: "json",
    note: "Chrome extensions work in every web app, and their buttons go in your bar.",
  },
  {
    ask: "Run all of manganese in a window of my own desktop.",
    code: 'import { runManganese } from "@domicile-desktop/manganese";\n\n<NestedShell shell={runManganese()} />',
    language: "tsx",
    note: "Shells, bars and panels are npm packages. Use anyone's, or nest a whole shell in yours.",
  },
];

/** Things a desktop can do once it's a web page, each as an ask and its code. */
export const Showcase = () => (
  <Section
    id="only"
    lede="Say it to your coding agent, or write it yourself. Either way, it's a few lines."
    title="Things you can do when your desktop is a web page."
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

const gridStyles = grid({ gap: 4, minChildWidth: "20rem" });

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
