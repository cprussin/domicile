import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import { LinkButton } from "../page/LinkButton";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";

const MODULE = `// notes.js
export const main = async (root, domicile) => {
  // A relative path is read from the home directory.
  const notes = await domicile.files.readText("notes.md");
  root.textContent = notes.unwrapOr("No notes yet");
};`;

const ENTRY = `# notes.desktop
[Desktop Entry]
Type=Application
Name=Notes
Exec=domicile open --app /usr/share/notes/notes.js`;

const POINTS = [
  {
    body: "Read and write files, run programs and talk over D-Bus, like any native app.",
    title: "The whole system",
  },
  {
    body: "Local storage, IndexedDB and cookies are separate for each app, so apps never trip over each other's saved state.",
    title: "Its own browser storage",
  },
  {
    body: "Ship a desktop entry and it shows up in the launcher, on every Domicile desktop.",
    title: "Installs like any app",
  },
];

const NOTES = ["notes.md", "groceries.md", "trip.md"];

/** Desktop apps written as JavaScript modules. */
export const Apps = () => (
  <Section
    id="apps"
    lede="A Domicile app is a JavaScript module. It gets a window, its own storage, and your files, programs and D-Bus, with no Electron and no browser to ship. Domicile's own Settings and History apps are built this way."
    title="Desktop apps, written like web pages."
  >
    <div className={showStyles}>
      <div className={codeStyles}>
        <CodeBlock code={MODULE} frame="bare" language="tsx" />
        <CodeBlock code={ENTRY} frame="bare" language="bash" />
      </div>
      <div aria-hidden="true" className={windowStyles}>
        <span className={titleBarStyles}>
          <span className={dotStyles} />
          Notes
        </span>
        <span className={windowBodyStyles}>
          <span className={sidebarStyles}>
            {NOTES.map((note, at) => (
              <span
                className={at === 0 ? openNoteStyles : noteStyles}
                key={note}
              >
                {note}
              </span>
            ))}
          </span>
          <span className={pageStyles}>
            <span className={headingStyles}>Ideas</span>
            <span className={lineStyles} />
            <span className={lineStyles} />
            <span className={lineStyles} />
          </span>
        </span>
      </div>
    </div>
    <div className={pointsStyles}>
      {POINTS.map((point) => (
        <div className={pointStyles} key={point.title}>
          <h3 className={pointTitleStyles}>{point.title}</h3>
          <p className={bodyStyles}>{point.body}</p>
        </div>
      ))}
    </div>
    <div className={actionsStyles}>
      <LinkButton href={repoFile("examples/minimal-app/README.md")} size="lg">
        See the example app
      </LinkButton>
      <LinkButton
        href={repoFile("docs/architecture/APP-MODULES.md")}
        size="lg"
        variant="outline"
      >
        How apps work
      </LinkButton>
    </div>
  </Section>
);

const showStyles = grid({
  gap: 5,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
  marginBlockEnd: 4,
});

const codeStyles = flex({
  "& pre": { paddingBlock: 4, paddingInline: 5 },
  backgroundColor: "syntax.ground",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  justify: "center",
  minInlineSize: 0,
  overflow: "hidden",
});

const windowStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "2xl",
  direction: "column",
  minBlockSize: 72,
  overflow: "hidden",
});

const titleBarStyles = flex({
  align: "center",
  borderBlockEnd: "1px solid {colors.border}",
  color: "muted",
  fontSize: "sm",
  gap: 2,
  paddingBlock: 2.5,
  paddingInline: 3.5,
});

const dotStyles = css({
  backgroundColor: "accent",
  blockSize: 2.5,
  borderRadius: "full",
  inlineSize: 2.5,
});

const windowBodyStyles = flex({ flex: 1 });

const sidebarStyles = flex({
  borderInlineEnd: "1px solid {colors.border}",
  direction: "column",
  flex: "none",
  fontSize: "sm",
  gap: 1.5,
  inlineSize: 40,
  padding: 3,
});

const noteStyles = css({
  color: "muted",
  paddingBlock: 1.5,
  paddingInline: 2.5,
});

const openNoteStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.accent} 22%, {colors.card})",
  borderRadius: "lg",
  paddingBlock: 1.5,
  paddingInline: 2.5,
});

const pageStyles = flex({
  "& > span:nth-of-type(3)": { inlineSize: "90%" },
  "& > span:nth-of-type(4)": { inlineSize: "60%" },
  direction: "column",
  flex: 1,
  gap: 2.5,
  minInlineSize: 0,
  padding: 4.5,
});

const headingStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "semibold",
});

const lineStyles = css({
  backgroundColor: "borderStrong",
  blockSize: 2,
  borderRadius: "sm",
  inlineSize: "80%",
});

const pointsStyles = grid({
  gap: 4,
  marginBlockEnd: 8,
  minChildWidth: "16rem",
});

const pointStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2,
  padding: 5,
});

const pointTitleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted", fontSize: "sm" });

const actionsStyles = flex({ gap: 3, wrap: "wrap" });
