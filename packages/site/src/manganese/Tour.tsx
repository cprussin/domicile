import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { Media } from "../media/Media";
import { Section } from "../page/Section";

type Feature = { media: string; title: string; body: string; shows: string };

/** Why to pick manganese, one capture each, named in `docs/media/`. */
const REASONS: readonly Feature[] = [
  {
    body: "Split, tab, stack, float and the scratchpad, on Sway's keys and with Sway's command names. Your fingers already know it.",
    media: "tour-tiling",
    shows: "Blender, GIMP and a film tabbed, then split, then one floated",
    title: "Tiling that feels like Sway",
  },
  {
    body: "Put the page you're reading beside the document you're writing. Web pages tile, tab, float and move between workspaces like every other window, with the same keys.",
    media: "tour-browser",
    shows: "LibreOffice beside a browser window with the address bar focused",
    title: "Websites are windows",
  },
  {
    body: "Add your password manager or ad blocker from the Chrome Web Store. Their buttons sit in the top bar, and they work in every browser window.",
    media: "tour-extensions",
    shows: "An extension popup open from the top bar",
    title: "Chrome extensions, on the desktop",
  },
];

/** The rest of a complete desktop, smaller. */
const EVERYTHING_ELSE: readonly Feature[] = [
  {
    body: "Apps, files and bookmarks in one search. Meta+Space.",
    media: "tour-launcher",
    shows: "The launcher opening, then a search for Settings",
    title: "The launcher",
  },
  {
    body: "Any site as its own app window, without an address bar.",
    media: "tour-web-apps",
    shows: "A web app window tiled beside LibreOffice",
    title: "Web apps",
  },
  {
    body: "Workspaces, tray, quick settings and the clock.",
    media: "tour-bar",
    shows:
      "The clock and status icons at the right end of the bar, over a browser window",
    title: "The top bar",
  },
  {
    body: "Toasts, and a drawer that keeps the ones you missed.",
    media: "tour-notifications",
    shows: "Two toasts arriving, then the drawer opening",
    title: "Notifications",
  },
  {
    body: "Meta+Shift+V. It keeps what you copied after the app closes.",
    media: "tour-clipboard",
    shows: "The clipboard history open with text and an image",
    title: "Clipboard history",
  },
  {
    body: "Press Print, pick an area, then save or copy it.",
    media: "tour-screenshots",
    shows: "The screenshot dialog open over a film and a browser",
    title: "Screenshots",
  },
  {
    body: "Meta+Shift+Return, before the machine sleeps, or after the idle time you set.",
    media: "tour-lock",
    shows: "The lock screen over the wallpaper",
    title: "Lock screen",
  },
  {
    body: "Windows move across the edge from one screen to the next.",
    media: "tour-monitors",
    shows: "A racing game moving from one screen to the other, still racing",
    title: "Several monitors",
  },
  {
    body: "Displays, theme, shell options and your browsing history.",
    media: "tour-settings",
    shows: "The Settings app beside GIMP",
    title: "Settings and History",
  },
];

/** Why manganese: its reasons, large. */
export const Tour = () => (
  <Section id="tour" title="Why manganese">
    <div className={rowsStyles}>
      {REASONS.map((feature) => (
        <article className={rowStyles} key={feature.title}>
          <div className={mediaStyles}>
            <Media alt={feature.shows} name={feature.media} />
          </div>
          <div className={textStyles}>
            <h3 className={titleStyles}>{feature.title}</h3>
            <p className={bodyStyles}>{feature.body}</p>
          </div>
        </article>
      ))}
    </div>
  </Section>
);

/** Everything else a desktop needs, as a grid of small captures. */
export const EverythingElse = () => (
  <Section
    id="everything-else"
    lede="The rest of a complete desktop, ready when you log in."
    title="And everything else"
  >
    <div className={gridStyles}>
      {EVERYTHING_ELSE.map((feature) => (
        <article className={cardStyles} key={feature.title}>
          <Media alt={feature.shows} name={feature.media} />
          <h3 className={cardTitleStyles}>{feature.title}</h3>
          <p className={cardBodyStyles}>{feature.body}</p>
        </article>
      ))}
    </div>
  </Section>
);

const rowsStyles = flex({ direction: "column", gap: 16 });

// Each capture about two thirds of the page, beside its text, on alternating
// sides. On a phone the text goes under it.
const rowStyles = flex({
  "&:nth-of-type(even)": { flexDirection: { md: "row-reverse" } },
  align: "center",
  direction: { base: "column", md: "row" },
  gap: { base: 4, md: 10 },
});

const mediaStyles = css({
  flex: { md: 2 },
  inlineSize: "100%",
  minInlineSize: 0,
});

const textStyles = flex({
  direction: "column",
  flex: { md: 1 },
  gap: 2,
  inlineSize: "100%",
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: "2xl",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted", fontSize: "md" });

const gridStyles = grid({
  gap: 6,
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 18rem), 1fr))",
});

const cardStyles = flex({ direction: "column", gap: 2, minInlineSize: 0 });

const cardTitleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
  marginBlockStart: 1,
});

const cardBodyStyles = css({ color: "muted", fontSize: "sm" });
