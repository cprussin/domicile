import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
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
    shows: "Three terminals opened, tabbed, and one floated",
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
    shows: "Meta+Space, three letters typed, Enter",
    title: "The launcher",
  },
  {
    body: "Any site can be an app window without an address bar, and without Electron.",
    media: "tour-web-apps",
    shows: "A web app window tiled beside a native app",
    title: "Web apps",
  },
  {
    body: "Workspaces, tray, volume, network, battery and the clock, see-through over your wallpaper.",
    media: "tour-bar",
    shows: "The bar up close with the volume popover open",
    title: "The top bar",
  },
  {
    body: "Toasts, plus a drawer that keeps the ones you missed.",
    media: "tour-notifications",
    shows: "A toast arriving, then the drawer opening",
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
    shows: "The screenshot dialog mid-selection",
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
    shows: "The Settings app's Displays page",
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
    <div className={gridStyles}>
      {FEATURES.map((feature) => (
        <article className={cardStyles} key={feature.title}>
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

const gridStyles = grid({ gap: 5, minChildWidth: "18.75rem" });

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  overflow: "hidden",
});

const mediaStyles = css({ padding: 2 });

const textStyles = flex({
  direction: "column",
  gap: 1.5,
  paddingBlockEnd: 5,
  paddingBlockStart: 3,
  paddingInline: 5,
});

const titleStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted", fontSize: "sm" });
