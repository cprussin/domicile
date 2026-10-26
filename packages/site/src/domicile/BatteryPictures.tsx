import { TelevisionSimpleIcon } from "@phosphor-icons/react/dist/ssr/TelevisionSimple";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { flex, grid, hstack } from "../../styled-system/patterns";
import type { Brand } from "./BrandMark";
import { BrandMark } from "./BrandMark";

const EXTENSIONS: readonly Brand[] = [
  "uBlockOrigin",
  "bitwarden",
  "grammarly",
  "googleTranslate",
  "darkReader",
];

const NOTIFICATIONS: readonly {
  brand: Brand;
  app: string;
  from: string;
  text: string;
}[] = [
  {
    app: "Discord",
    brand: "discord",
    from: "app",
    text: "Priya: are you joining voice?",
  },
  {
    app: "Gmail",
    brand: "gmail",
    from: "mail.google.com",
    text: "Your flight to Lisbon is confirmed",
  },
  {
    app: "Google Calendar",
    brand: "googleCalendar",
    from: "calendar.google.com",
    text: "Standup starts in 5 minutes",
  },
];

const THEMED = ["GTK app", "Qt app", "Website"];

/** A browser toolbar of extension buttons, one open. */
export const ExtensionsPicture = () => (
  <Picture>
    <div className={toolbarStyles}>
      <span className={addressStyles}>github.com/cprussin/domicile</span>
      {EXTENSIONS.map((brand) => (
        <BrandMark brand={brand} key={brand} />
      ))}
    </div>
    <div className={popupStyles}>
      <span className={strongStyles}>Bitwarden</span>
      <span className={loginStyles({ picked: true })}>
        you@github <span className={accentStyles}>Fill</span>
      </span>
      <span className={loginStyles({ picked: false })}>
        work@github <span>Fill</span>
      </span>
    </div>
  </Picture>
);

/** Notifications from an app and two websites, in one list. */
export const NotificationsPicture = () => (
  <Picture>
    <div className={stackStyles}>
      {NOTIFICATIONS.map((note) => (
        <div className={noteStyles} key={note.app}>
          <BrandMark brand={note.brand} />
          <span className={noteTextStyles}>
            <span className={strongStyles}>
              {note.app} <span className={mutedStyles}>· {note.from}</span>
            </span>
            <span className={mutedStyles}>{note.text}</span>
          </span>
        </div>
      ))}
    </div>
  </Picture>
);

/** The screen-sharing picker, a window picked. */
export const SharingPicture = () => (
  <Picture>
    <span className={strongStyles}>Share your screen with meet.google.com</span>
    <span className={pillsStyles}>
      <span className={pillStyles({ picked: true })}>Window</span>
      <span className={pillStyles({ picked: false })}>Monitor</span>
      <span className={pillStyles({ picked: false })}>Region</span>
    </span>
    <span className={thumbsStyles}>
      <span className={thumbStyles({ picked: true })} />
      <span className={thumbStyles({ picked: false })} />
      <span className={thumbStyles({ picked: false })} />
    </span>
    <span className={checkRowStyles}>
      <span className={checkStyles} />
      <span className={mutedStyles}>Share sound too</span>
    </span>
  </Picture>
);

/** The list of TVs, one connected. */
export const CastPicture = () => (
  <Picture>
    <span className={tvStyles({ connected: true })}>
      <span className={tvNameStyles}>
        <TelevisionSimpleIcon />
        Living room TV
      </span>
      <span className={accentStyles}>Connected</span>
    </span>
    <span className={castActionsStyles}>
      <span className={actionStyles({ primary: true })}>Extend desktop</span>
      <span className={actionStyles({ primary: false })}>Cast…</span>
    </span>
    <span className={tvStyles({ connected: false })}>
      <span className={tvNameStyles}>
        <TelevisionSimpleIcon />
        Bedroom
      </span>
    </span>
  </Picture>
);

/** The brightness and night light controls. */
export const NightLightPicture = () => (
  <Picture>
    <span className={sliderRowStyles}>
      <span className={rowLabelStyles}>
        Brightness
        <span className={checkRowStyles}>
          <span className={mutedStyles}>Automatic</span>
          <span className={switchStyles}>
            <span className={knobStyles} />
          </span>
        </span>
      </span>
      <span className={trackStyles}>
        <span className={fillStyles} />
      </span>
    </span>
    <span className={sliderRowStyles}>
      <span className={rowLabelStyles}>
        Night light
        <span className={mutedStyles}>Sunset to sunrise</span>
      </span>
      <span className={warmthStyles} />
      <span className={rowLabelStyles}>
        <span className={mutedStyles}>6500 K</span>
        <span className={mutedStyles}>3400 K</span>
      </span>
    </span>
  </Picture>
);

/** Three kinds of window, all in the same theme. */
export const ThemePicture = () => (
  <Picture>
    <span className={windowsStyles}>
      {THEMED.map((kind) => (
        <span className={windowStyles} key={kind}>
          <span className={titleBarStyles}>
            <span className={dotStyles({ lit: true })} />
            <span className={dotStyles({ lit: false })} />
          </span>
          <span className={windowBodyStyles}>
            <span className={lineStyles({ width: "long" })} />
            <span className={lineStyles({ width: "full" })} />
            <span className={lineStyles({ width: "short" })} />
            <span className={buttonStyles} />
          </span>
          <span className={windowLabelStyles}>{kind}</span>
        </span>
      ))}
    </span>
  </Picture>
);

/** The frame every picture sits in. Decoration: the card's text says it all. */
const Picture = ({ children }: { children: ReactNode }) => (
  <div aria-hidden="true" className={pictureStyles}>
    {children}
  </div>
);

const pictureStyles = flex({
  backgroundColor:
    "color-mix(in oklab, {colors.card} 60%, {colors.background})",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  direction: "column",
  fontSize: "xs",
  gap: 3,
  justify: "center",
  minBlockSize: 44,
  overflow: "hidden",
  padding: 3.5,
});

const strongStyles = css({ fontWeight: "semibold" });

const mutedStyles = css({ color: "muted" });

const accentStyles = css({ color: "accent" });

const toolbarStyles = hstack({ gap: 2 });

const addressStyles = css({
  backgroundColor: "card",
  borderRadius: "full",
  color: "muted",
  flex: 1,
  minInlineSize: 0,
  overflow: "hidden",
  paddingBlock: 1.5,
  paddingInline: 3,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const popupStyles = flex({
  alignSelf: "flex-end",
  backgroundColor: "card",
  border: "1px solid {colors.borderStrong}",
  borderRadius: "lg",
  boxShadow: "lifted",
  direction: "column",
  gap: 2,
  inlineSize: 56,
  marginInlineEnd: 8,
  maxInlineSize: "100%",
  padding: 3,
});

const loginStyles = cva({
  base: flex.raw({ borderRadius: "md", justify: "space-between", padding: 2 }),
  variants: {
    picked: {
      false: { color: "muted" },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 22%, {colors.card})",
      },
    },
  },
});

const stackStyles = flex({ direction: "column", gap: 2 });

const noteStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  gap: 3,
  paddingBlock: 2.5,
  paddingInline: 3,
});

const noteTextStyles = flex({ direction: "column", minInlineSize: 0 });

const pillStyles = cva({
  base: { borderRadius: "full", paddingBlock: 1, paddingInline: 2.5 },
  variants: {
    picked: {
      false: { backgroundColor: "card", color: "muted" },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 22%, {colors.card})",
      },
    },
  },
});

const pillsStyles = hstack({ gap: 1.5 });

const thumbsStyles = grid({ columns: 3, gap: 2 });

const thumbStyles = cva({
  base: { backgroundColor: "card", blockSize: 14, borderRadius: "md" },
  variants: {
    picked: {
      false: { border: "1px solid {colors.borderStrong}" },
      true: { border: "2px solid {colors.accent}" },
    },
  },
});

const checkRowStyles = hstack({ gap: 2 });

const checkStyles = css({
  backgroundColor: "accent",
  blockSize: 3.5,
  borderRadius: "sm",
  inlineSize: 3.5,
});

const tvStyles = cva({
  base: flex.raw({
    align: "center",
    border: "1px solid {colors.border}",
    borderRadius: "lg",
    fontSize: "sm",
    justify: "space-between",
    paddingBlock: 2.5,
    paddingInline: 3,
  }),
  variants: {
    connected: {
      false: { backgroundColor: "card", color: "muted" },
      true: {
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 22%, {colors.card})",
        borderColor:
          "color-mix(in oklab, {colors.accent} 35%, {colors.border})",
      },
    },
  },
});

const tvNameStyles = hstack({ gap: 2.5 });

const castActionsStyles = hstack({ gap: 2, paddingInlineStart: 3 });

const actionStyles = cva({
  base: {
    borderRadius: "md",
    fontSize: "sm",
    paddingBlock: 1.5,
    paddingInline: 3,
  },
  variants: {
    primary: {
      false: { border: "1px solid {colors.borderStrong}" },
      true: {
        backgroundColor: "accent",
        color: "background",
        fontWeight: "semibold",
      },
    },
  },
});

const sliderRowStyles = flex({ direction: "column", gap: 2 });

const rowLabelStyles = flex({
  align: "center",
  fontSize: "sm",
  justify: "space-between",
});

const switchStyles = flex({
  backgroundColor: "accent",
  blockSize: 4.5,
  borderRadius: "full",
  inlineSize: 8,
  justify: "flex-end",
  padding: 0.5,
});

const knobStyles = css({
  backgroundColor: "background",
  blockSize: 3.5,
  borderRadius: "full",
  inlineSize: 3.5,
});

const trackStyles = css({
  backgroundColor: "borderStrong",
  blockSize: 1.5,
  borderRadius: "full",
});

const fillStyles = css({
  backgroundColor: "accent",
  blockSize: "100%",
  borderRadius: "full",
  display: "block",
  inlineSize: "62%",
});

// The same in both themes: it shows the screen's color, not the page's.
const warmthStyles = css({
  backgroundImage:
    "linear-gradient(to right, {colors.syntax.plain}, {colors.warning})",
  blockSize: 1.5,
  borderRadius: "full",
});

const windowsStyles = grid({ columns: 3, gap: 2.5 });

const windowStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.borderStrong}",
  borderRadius: "md",
  direction: "column",
  overflow: "hidden",
});

const titleBarStyles = hstack({
  backgroundColor: "border",
  blockSize: 4.5,
  gap: 1,
  paddingInline: 1.5,
});

const dotStyles = cva({
  base: { blockSize: 1.5, borderRadius: "full", inlineSize: 1.5 },
  variants: {
    lit: {
      false: { backgroundColor: "borderStrong" },
      true: { backgroundColor: "accent" },
    },
  },
});

const windowBodyStyles = flex({
  blockSize: 20,
  direction: "column",
  gap: 1.5,
  padding: 2,
});

const lineStyles = cva({
  base: { backgroundColor: "borderStrong", blockSize: 1.5, borderRadius: "sm" },
  variants: {
    width: {
      full: { inlineSize: "90%" },
      long: { inlineSize: "70%" },
      short: { inlineSize: "50%" },
    },
  },
});

const buttonStyles = css({
  backgroundColor: "accent",
  blockSize: 3.5,
  borderRadius: "sm",
  inlineSize: 12,
  marginBlockStart: "auto",
});

const windowLabelStyles = css({
  borderBlockStart: "1px solid {colors.borderStrong}",
  color: "muted",
  paddingBlock: 1.5,
  paddingInline: 2,
});
