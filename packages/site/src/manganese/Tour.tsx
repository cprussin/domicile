import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Media } from "../media/Media";
import { Section } from "../page/Section";

/** Each feature and the capture that shows it, named in `docs/media/`. */
const FEATURES: readonly {
  media: string;
  title: string;
  body: string;
  shows: string;
}[] = [
  {
    body: "Split, tab, stack, float and the scratchpad, with Sway's layout.",
    media: "tour-tiling",
    shows: "Three terminals tabbed, then split, then one floated",
    title: "Tiling, Sway-style",
  },
  {
    body: "Web pages are windows, under an address bar, tiled next to your terminal. Private windows too.",
    media: "tour-browser",
    shows: "A terminal beside a browser window with the address bar focused",
    title: "A browser, built in",
  },
  {
    body: "Name them in the config. Their toolbar buttons and popups work in every browser window.",
    media: "tour-extensions",
    shows: "An extension popup open from the toolbar",
    title: "Chrome extensions",
  },
  {
    body: "Apps, files in your home and bookmarks in one search. Meta+Space.",
    media: "tour-launcher",
    shows: "The launcher opening, then a search for Settings",
    title: "The launcher",
  },
  {
    body: "Any site can be an app window without an address bar, and without Electron.",
    media: "tour-web-apps",
    shows: "A web app window tiled beside a terminal",
    title: "Web apps",
  },
  {
    body: "Workspaces, tray, volume, network, battery and the clock, see-through over your wallpaper.",
    media: "tour-bar",
    shows:
      "The clock and status icons at the right end of the bar, over a browser window",
    title: "The top bar",
  },
  {
    body: "Toasts, plus a drawer that keeps the ones you missed.",
    media: "tour-notifications",
    shows: "Two toasts arriving, then the drawer opening",
    title: "Notifications",
  },
  {
    body: "Meta+Shift+V. It keeps what you copied even after the app that copied it closes.",
    media: "tour-clipboard",
    shows: "The clipboard history open with text and an image",
    title: "Clipboard history",
  },
  {
    body: "Press Print, pick an area, then save it or copy it.",
    media: "tour-screenshots",
    shows: "The screenshot dialog open over a terminal and a browser",
    title: "Screenshots",
  },
  {
    body: "It locks when you go idle, before the machine sleeps, or on Meta+Shift+Return.",
    media: "tour-lock",
    shows: "The lock screen over the wallpaper",
    title: "Lock screen",
  },
  {
    body: "Windows move across the edge from one screen to the next.",
    media: "tour-monitors",
    shows: "A window moving from one screen to the other",
    title: "Several monitors",
  },
  {
    body: "Apps for displays, theme and shell options, and for your browsing history.",
    media: "tour-settings",
    shows: "The Settings app beside a terminal",
    title: "Settings and History",
  },
];

/** What manganese does, one capture each. */
export const Tour = () => (
  <Section
    id="tour"
    lede="Plus a few things other desktops don't have."
    title="Everything a desktop needs"
  >
    <div className={rowsStyles}>
      {FEATURES.map((feature) => (
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
