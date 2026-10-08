import { Button } from "@domicile-desktop/component-library/Button";
import {
  useDisplays,
  useScreenRegion,
} from "@domicile-desktop/component-library/DisplayProvider";
import { Input } from "@domicile-desktop/component-library/Input";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack, vstack } from "../../styled-system/patterns";
import { LockClock } from "./LockClock";

/** The field's label, also used by tests to find it. */
const PASSPHRASE = "Passphrase";

type Props = {
  /** Whether the compositor says the desktop is locked. */
  locked: boolean;
  /** Whether a submitted passphrase is awaiting the compositor's answer. */
  checking: boolean;
  /** How many passphrases the compositor has refused; see `useLocked`. */
  refusals: number;
  /**
   * Submit a passphrase to the compositor.
   *
   * Success arrives as {@link locked} turning off; failure as {@link refusals}
   * going up.
   */
  onUnlock: (passphrase: string) => void;
  /** Shown under the field, such as `LockReadouts`. */
  children?: ReactNode;
  /**
   * A picture an application set for the lock screen through the Wallpaper
   * portal, as a URL. Covers each screen in place of the blurred desktop.
   */
  picture?: string | undefined;
  /** The screen to ask for the passphrase on: the one with the keyboard. */
  screen: string;
};

/**
 * The lock screen: a full-desktop sheet with a passphrase field.
 *
 * The sheet catches input over the whole page, but only each screen is
 * blurred: a blur over the gaps between monitors costs as much as one over
 * the monitors themselves.
 *
 * The compositor holds the lock and stops injecting this page's input into the
 * Wayland seat while locked. This component holds no lock state; it only draws
 * over the desktop and sends the passphrase, so reloading the page cannot
 * unlock it. See docs/LOCK.md.
 *
 * It stays mounted and is `inert` while unlocked so it can fade in and out;
 * once faded it is `display: none`, so it never catches clicks on the desktop.
 *
 * While locked, focus stays in the field, since nothing else takes keys. A
 * control in `children` works by pointer and gives the focus back.
 *
 * Nothing dismisses it except unlocking: not Escape, an outside click or
 * submit. That is why it does not use `ModalDialog`.
 */
export const Lock = ({
  checking,
  children,
  locked,
  onUnlock,
  picture,
  refusals,
  screen,
}: Props) => {
  const displays = useDisplays();
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // Focus the field when the desktop locks, so the first keys typed are not
  // lost. Done on the transition because the sheet is always mounted.
  //
  // Clear the field on unlock: the sheet stays mounted to fade out.
  useEffect(() => {
    if (locked) {
      field.current?.focus();
    } else {
      setTyped("");
      setWrong(false);
    }
  }, [locked]);

  // Clear the field on a refusal, so a wrong guess is not left on a locked
  // screen.
  useEffect(() => {
    if (refusals > 0) {
      setTyped("");
      setWrong(true);
    }
  }, [refusals]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the sheet is not a control and is not being made into one — these keep the focus in the field, which is the only thing on a locked desk to type into
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same handlers, and the same reason
    <div
      className={sheetStyles}
      inert={!locked}
      // Take the focus back from a slider, which focuses itself on a click.
      onFocus={(event) => {
        if (event.target !== field.current) {
          field.current?.focus();
        }
      }}
      // Keep focus in the field. The button still submits on click, and Tab has
      // nowhere else to go.
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
        }
      }}
      onMouseDown={(event) => {
        if (event.target !== field.current) {
          event.preventDefault();
        }
      }}
    >
      {displays === undefined ? (
        // The whole page until the host describes the screens, so a desk
        // that locks while starting is not left readable.
        <Veil screen={undefined} />
      ) : (
        displays.map(({ name }) => <Veil key={name} screen={name} />)
      )}
      {picture !== undefined &&
        (displays === undefined ? (
          <LockPicture picture={picture} screen={undefined} />
        ) : (
          displays.map(({ name }) => (
            <LockPicture key={name} picture={picture} screen={name} />
          ))
        ))}
      <div
        className={contentStyles}
        data-lock-content=""
        style={useScreenRegion(screen)}
      >
        <LockClock />
        <div className={entryStyles}>
          <form
            className={formStyles({ shaken: shaken(refusals), wrong })}
            onSubmit={(event) => {
              // Prevent navigation: reloading would drop the connection the
              // shell runs on.
              event.preventDefault();
              // One submission at a time; the compositor drops a second one
              // sent while the first is being checked.
              if (!checking) {
                onUnlock(typed);
              }
            }}
          >
            <Input
              aria-label={PASSPHRASE}
              name="passphrase"
              onChange={(event) => {
                setTyped(event.target.value);
                setWrong(false);
              }}
              placeholder={PASSPHRASE}
              prefixIcon={<LockIcon />}
              // Read-only while checking, so the screen shows what is being
              // checked.
              readOnly={checking}
              ref={field}
              rounded
              size="lg"
              // Keep the passphrase hidden from anyone looking at the screen.
              type="password"
              value={typed}
            />
            <Button
              label="Unlock"
              loading={checking}
              rounded
              size="lg"
              type="submit"
            >
              <ArrowRightIcon />
            </Button>
          </form>
          {wrong ? (
            <p className={refusalStyles} role="alert">
              Wrong passphrase
            </p>
          ) : undefined}
        </div>
        {children}
      </div>
    </div>
  );
};

/**
 * The blurred veil over display `screen`, or the whole page. Data attribute
 * for tests.
 */
const Veil = ({ screen }: { screen: string | undefined }) => (
  <div className={veilStyles} data-veil="" style={useScreenRegion(screen)} />
);

/**
 * The lock screen's picture on display `screen`, or the whole page. Data
 * attribute for tests.
 */
const LockPicture = ({
  picture,
  screen,
}: {
  picture: string;
  screen: string | undefined;
}) => (
  // Empty `alt` because the picture is decorative.
  <img
    alt=""
    className={pictureStyles}
    data-lock-picture=""
    src={picture}
    style={useScreenRegion(screen)}
  />
);

// Above everything, including modal panels like the launcher, so nothing can
// take input over the lock. `lock` is the preset's z-index token for it. One
// sheet spans every display, since the page is the whole desktop. It paints
// nothing itself; its veils and content fade.
//
// `allow-discrete` delays `display: none` until the fade ends.
const sheetStyles = css({
  "&[inert]": {
    display: "none",
  },
  inset: 0,
  position: "fixed",
  transition: "display {durations.slowest} allow-discrete",
  zIndex: "lock",
});

// One screen's veil. The desktop shows through blurred rather than hidden:
// the blur keeps it unreadable. The tint and vignette keep the clock legible.
//
// It fades and blurs in and out together. The veil fades itself rather than
// the sheet, since a parent below full opacity would leave its blur nothing
// to blur. The whole sheet, narrowed to a monitor by the region from
// `useScreenRegion`.
const veilStyles = css({
  _starting: {
    backdropFilter: "blur(0) saturate(100%)",
    opacity: 0,
  },
  "[inert] > &": {
    backdropFilter: "blur(0) saturate(100%)",
    opacity: 0,
  },
  backdropFilter: "blur({spacing.16}) saturate(160%)",
  backgroundColor: "color-mix(in oklab, {colors.background} 20%, transparent)",
  backgroundImage:
    "radial-gradient(ellipse at center, transparent 40%, color-mix(in oklab, {colors.background} 50%, transparent))",
  inset: 0,
  opacity: 1,
  position: "absolute",
  transition:
    "opacity {durations.slowest} {easings.out}, backdrop-filter {durations.slowest} {easings.out}",
});

// Over the veils, so the picture shows sharp, and fading with them. Cropped
// to the monitor's shape.
const pictureStyles = css({
  _starting: { opacity: 0 },
  "[inert] > &": { opacity: 0 },
  blockSize: "100%",
  inlineSize: "100%",
  inset: 0,
  objectFit: "cover",
  opacity: 1,
  position: "absolute",
  transition: "opacity {durations.slowest} {easings.out}",
});

// The clock and field rise in as the desktop blurs, and sink as it clears.
// Centered on one screen, narrowed by the region from `useScreenRegion`, since
// the page's center can fall between monitors.
const contentStyles = vstack({
  _starting: {
    opacity: 0,
    transform: "translateY({spacing.6}) scale(0.97)",
  },
  "[inert] > &": {
    opacity: 0,
    transform: "translateY({spacing.6}) scale(0.97)",
  },
  gap: 10,
  inset: 0,
  justifyContent: "center",
  opacity: 1,
  // Positioned, so it draws over the veils before it.
  position: "absolute",
  transform: "none",
  transition:
    "opacity {durations.slowest} {easings.out}, transform {durations.slowest} {easings.emphasized}",
});

// Positioned under the pane, so showing a refusal does not move the clock.
const entryStyles = css({
  position: "relative",
});

// A glass pane (see `ModalDialog`) around the field and button.
//
// A refusal shakes it and outlines it in `danger` until the user types again.
// There are two identical shake keyframes, alternated, because an animation
// whose name does not change does not replay. See `shaken`.
const formStyles = cva({
  base: hstack.raw({
    _before: {
      background:
        "linear-gradient(90deg, transparent, color-mix(in oklab, {colors.foreground} 45%, transparent), transparent)",
      blockSize: "1px",
      content: '""',
      insetBlockStart: 0,
      insetInline: 6,
      position: "absolute",
    },
    "& :has(> [data-control])": {
      backgroundColor:
        "color-mix(in oklab, {colors.background} 45%, transparent)",
    },
    "& > :first-child": {
      flex: 1,
    },
    animationDuration: "{durations.slowest}",
    animationTimingFunction: "{easings.out}",
    backdropFilter: "blur({spacing.6}) saturate(180%)",
    backgroundColor: "color-mix(in oklab, {colors.card} 55%, transparent)",
    border:
      "1px solid color-mix(in oklab, {colors.foreground} 14%, transparent)",
    borderRadius: "full",
    boxShadow: "modal",
    gap: 2,
    inlineSize: 96,
    padding: 2,
    position: "relative",
    transition: "border-color {durations.normal} {easings.out}",
  }),
  variants: {
    shaken: {
      again: { animationName: "lockRefusedAgain" },
      never: {},
      once: { animationName: "lockRefused" },
    },
    wrong: {
      false: {},
      true: {
        borderColor: "color-mix(in oklab, {colors.danger} 70%, transparent)",
      },
    },
  },
});

const refusalStyles = css({
  color: "danger",
  fontSize: "sm",
  fontWeight: "medium",
  insetBlockStart: "100%",
  insetInline: 0,
  marginBlockStart: 3,
  position: "absolute",
  textAlign: "center",
  textShadow: "textOverPhoto",
});

/** Which shake keyframes to use for the {@link refusals}th refusal. */
const shaken = (refusals: number): "never" | "once" | "again" => {
  if (refusals === 0) {
    return "never";
  } else {
    return refusals % 2 === 1 ? "once" : "again";
  }
};
