import type { ReactNode } from "react";

import { css, cx } from "../../styled-system/css";
import { flex, grid, hstack } from "../../styled-system/patterns";
import { BrandMark } from "./BrandMark";

/** Links to the page's main sections, each with a picture of it. */
export const SectionLinks = () => (
  <nav aria-label="On this page" className={linksStyles}>
    <SectionLink
      body="Pick a window model, change the code, run it."
      href="#make"
      picture={<MakePicture />}
      title="Make your own"
    />
    <SectionLink
      body="Your layout is a stylesheet."
      href="#css"
      picture={<CssPicture />}
      title="Tile with CSS"
    />
    <SectionLink
      body="Screen sharing, notifications, extensions and more, free."
      href="#batteries"
      picture={<BatteriesPicture />}
      title="Batteries included"
    />
    <SectionLink
      body="Write real apps with web tech. No Electron."
      href="#apps"
      picture={<AppsPicture />}
      title="Desktop apps"
    />
    <SectionLink
      body="Publish your whole desktop, or just your bar."
      href="#npm"
      picture={<NpmPicture />}
      title="Share on npm"
    />
    <SectionLink
      body="A finished shell to use as is or build on."
      href="#manganese"
      picture={<ManganesePicture />}
      title="Start from manganese"
    />
  </nav>
);

type LinkProps = {
  href: string;
  picture: ReactNode;
  title: string;
  body: string;
};

/** One section's card. */
const SectionLink = ({ href, picture, title, body }: LinkProps) => (
  <a className={cx("group", linkStyles)} href={href}>
    <span aria-hidden="true" className={pictureStyles}>
      {picture}
    </span>
    <span className={titleStyles}>{title}</span>
    <span className={bodyStyles}>{body}</span>
  </a>
);

/** The builder: window models over a line of the code that draws one. */
const MakePicture = () => (
  <span className={makePictureStyles}>
    <span className={modelsStyles}>
      <span className={pickedModelStyles}>Tiling</span>
      <span className={modelStyles}>Floating</span>
      <span className={modelStyles}>Tabs</span>
    </span>
    <span className={ruleStyles}>
      {'<main className="grid gap-2">\n  {windows.map(…)}\n</main>'}
    </span>
  </span>
);

/** Panes tiled beside the CSS that tiles them. */
const CssPicture = () => (
  <span className={cssPictureStyles}>
    <span className={ruleStyles}>
      {"main {\n  display: grid;\n  gap: 8px;\n}"}
    </span>
    <span className={paneStyles} />
    <span className={paneStyles} />
  </span>
);

/** A notification, extension buttons and the night light's warmth. */
const BatteriesPicture = () => (
  <span className={batteriesPictureStyles}>
    <span className={notificationStyles}>
      <BrandMark brand="discord" />
      Discord · New message
    </span>
    <span className={marksStyles}>
      <BrandMark brand="uBlockOrigin" />
      <BrandMark brand="bitwarden" />
      <BrandMark brand="grammarly" />
      <BrandMark brand="googleTranslate" />
    </span>
    <span className={warmthStyles} />
  </span>
);

/** An app window, in the other theme so it stands out. */
const AppsPicture = () => (
  <span className={appWindowStyles}>
    <span className={appTitleBarStyles} />
    <span className={appBodyStyles}>
      <span className={appSidebarStyles} />
      <span className={appPageStyles}>
        <span className={appHeadingStyles} />
        <span className={appLineStyles} />
        <span className={appLineStyles} />
      </span>
    </span>
  </span>
);

/** npm's logo over an install. */
const NpmPicture = () => (
  <span className={npmPictureStyles}>
    <BrandMark brand="npm" />
    <span className={commandStyles}>
      <span className={promptStyles}>$</span> npm i @you/cool-bar
    </span>
  </span>
);

/** A manganese desktop: a bar and two tiled windows, in its color. */
const ManganesePicture = () => (
  <span className={desktopStyles}>
    <span className={barStyles}>
      <span className={workspaceStyles} />
    </span>
    <span className={tilesStyles}>
      <span className={focusedTileStyles} />
      <span className={tileStyles} />
    </span>
  </span>
);

const linksStyles = grid({
  gap: 3,
  inlineSize: "100%",
  marginBlockStart: 6,
  minChildWidth: "12rem",
  textAlign: "start",
});

// Lifts toward the pointer, with its title in the accent, so the card reads
// as a link.
const linkStyles = flex({
  _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: 2 },
  _motionReduce: { "&:is(:hover, :focus-visible)": { transform: "none" } },
  "&:is(:hover, :focus-visible)": {
    borderColor: "accent",
    boxShadow: "lifted",
    transform: "translateY(-2px)",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 1,
  minInlineSize: 0,
  padding: 3,
  paddingBlockEnd: 4,
  transition:
    "border-color {durations.fast} {easings.out}, box-shadow {durations.fast} {easings.out}, transform {durations.fast} {easings.out}",
});

const pictureStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.card} 60%, {colors.background})",
  blockSize: 28,
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  display: "block",
  marginBlockEnd: 2,
  overflow: "hidden",
  position: "relative",
});

const titleStyles = css({
  _groupFocusVisible: { color: "accent" },
  _groupHover: { color: "accent" },
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
  paddingInline: 1,
  transition: "color {durations.fast} {easings.out}",
});

const bodyStyles = css({
  color: "muted",
  fontSize: "sm",
  lineHeight: "snug",
  paddingInline: 1,
});

const makePictureStyles = flex({
  blockSize: "100%",
  direction: "column",
  gap: 1.5,
  padding: 2.5,
});

const modelsStyles = hstack({ gap: 1 });

const modelStyles = css({
  border: "1px solid {colors.border}",
  borderRadius: "full",
  fontSize: "2xs",
  paddingInline: 1.5,
});

const pickedModelStyles = css({
  border: "1px solid {colors.accent}",
  borderRadius: "full",
  color: "accent",
  fontSize: "2xs",
  paddingInline: 1.5,
});

const cssPictureStyles = grid({
  blockSize: "100%",
  gap: 1.5,
  gridTemplateColumns: "3fr 2fr",
  gridTemplateRows: "1fr 1fr",
  padding: 2.5,
});

const ruleStyles = css({
  backgroundColor: "syntax.ground",
  borderRadius: "md",
  color: "syntax.property",
  fontFamily: "code",
  fontSize: "2xs",
  gridRow: "span 2",
  padding: 2,
  whiteSpace: "pre",
});

const paneStyles = css({
  "&:last-child": { border: "2px solid {colors.accent}" },
  backgroundColor: "borderStrong",
  borderRadius: "md",
});

const batteriesPictureStyles = flex({
  blockSize: "100%",
  direction: "column",
  gap: 2,
  padding: 2.5,
});

const notificationStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  fontSize: "2xs",
  gap: 2,
  padding: 1.5,
});

const marksStyles = hstack({ gap: 1.5 });

// The same in both themes: it shows the screen's color, not the page's.
const warmthStyles = css({
  backgroundImage:
    "linear-gradient(to right, {colors.syntax.plain}, {colors.warning})",
  blockSize: 1.5,
  borderRadius: "full",
  marginBlockStart: "auto",
});

const appWindowStyles = flex({
  backgroundColor: "foreground",
  borderRadius: "md",
  direction: "column",
  insetBlockEnd: -3,
  insetBlockStart: 3.5,
  insetInline: 3.5,
  overflow: "hidden",
  position: "absolute",
});

const appTitleBarStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.foreground} 85%, {colors.background})",
  blockSize: 4,
});

const appBodyStyles = flex({ flex: 1 });

const appSidebarStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.foreground} 92%, {colors.background})",
  inlineSize: "34%",
});

const appPageStyles = flex({
  direction: "column",
  flex: 1,
  gap: 1.5,
  padding: 2,
});

const appHeadingStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.foreground} 25%, {colors.background})",
  blockSize: 2,
  borderRadius: "sm",
  inlineSize: "50%",
});

const appLineStyles = css({
  backgroundColor:
    "color-mix(in oklab, {colors.foreground} 75%, {colors.background})",
  blockSize: 1.5,
  borderRadius: "sm",
});

const npmPictureStyles = flex({
  blockSize: "100%",
  direction: "column",
  gap: 2,
  justify: "center",
  padding: 2.5,
});

const commandStyles = css({
  backgroundColor: "card",
  borderRadius: "md",
  fontFamily: "code",
  fontSize: "2xs",
  overflow: "hidden",
  padding: 2,
  whiteSpace: "nowrap",
});

const promptStyles = css({ color: "muted" });

const desktopStyles = flex({
  backgroundColor:
    "color-mix(in oklab, {colors.manganese} 25%, {colors.background})",
  blockSize: "100%",
  direction: "column",
  gap: 1.5,
  padding: 2,
});

const barStyles = hstack({
  backgroundColor: "color-mix(in oklab, {colors.background} 60%, transparent)",
  blockSize: 3,
  borderRadius: "sm",
  paddingInline: 1.5,
});

const workspaceStyles = css({
  backgroundColor: "manganese",
  blockSize: 1.5,
  borderRadius: "xs",
  inlineSize: 3,
});

const tilesStyles = grid({ flex: 1, gap: 1.5, gridTemplateColumns: "3fr 2fr" });

const tileStyles = css({
  backgroundColor: "background",
  border: "1px solid {colors.border}",
  borderRadius: "sm",
});

const focusedTileStyles = css({
  backgroundColor: "background",
  border: "1px solid {colors.manganese}",
  borderRadius: "sm",
});
