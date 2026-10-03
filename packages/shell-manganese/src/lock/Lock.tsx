import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { useEffect, useRef, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { center, hstack, vstack } from "../../styled-system/patterns";
import { LockClock } from "./LockClock";

/** What the field is called, which is also how a test finds it. */
const PASSPHRASE = "Passphrase";

type Props = {
  /** Whether the compositor says this desk is locked. */
  locked: boolean;
  /** Whether a passphrase is out with the compositor, unanswered. */
  checking: boolean;
  /** How many passphrases the compositor has turned down — see `useLocked`. */
  refusals: number;
  /**
   * Offer this passphrase to the compositor.
   *
   * What opens the desk is the compositor agreeing, and what says so is the
   * `locked` message that turns {@link locked} off; what says it did not is
   * {@link refusals} going up.
   */
  onUnlock: (passphrase: string) => void;
};

/**
 * The lock screen: a sheet over the whole desktop with a passphrase on it.
 *
 * **IT IS NOT WHAT LOCKS THE DESK, AND IT IS NOT WHAT UNLOCKS IT EITHER.** The
 * compositor holds the lock — while it is shut, nothing this page forwards is
 * put into the Wayland seat, so no client on this desk sees a keystroke or a
 * click. This component draws over a desktop that has already stopped listening
 * and collects what somebody types; the compositor decides whether that opens
 * anything. So there is no local state here for a click to flip, which is what
 * makes the lock survive a reload of this page.
 *
 * A picture of the same thing would be indistinguishable from this one, and that
 * is fine: what the picture would be missing is not on the page at all.
 *
 * **On the page the whole time, and inert while the desk is open.** It fades in
 * and out — the desktop blurring away under it and coming back into focus — so
 * it has to outlive the `locked` that took it away. While the desk is open it is
 * `inert` and, once the fade is over, `display: none`: a sheet over the whole
 * desktop that was merely transparent would take every click on the desk with
 * it, and the desk this shell draws is the one somebody is working at.
 *
 * **The keyboard stays in the field while the desk is shut.** Nothing else on a
 * locked desk is anything to type into, so a key that went anywhere else is a
 * key of the passphrase thrown away.
 *
 * **Nothing dismisses it.** Not Escape, not a click beside it, not submitting:
 * `ModalDialog` is the wrong primitive here for exactly that reason — every one
 * of its ways out is a way past this. The only thing that takes this off the
 * screen is the desk opening.
 */
export const Lock = ({ checking, locked, onUnlock, refusals }: Props) => {
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // The sheet is up because the desk shut, so the keyboard belongs in the field:
  // a lock screen where the first thing typed goes nowhere is one somebody types
  // their passphrase into twice. Taken on the edge, which is the moment the desk
  // shut — the sheet itself is on the page the whole time.
  //
  // And cleared as it opens: the sheet outlives the lock to fade out, and a
  // passphrase left in it would be one sitting in the page of an open desk.
  useEffect(() => {
    if (locked) {
      field.current?.focus();
    } else {
      setTyped("");
      setWrong(false);
    }
  }, [locked]);

  // A refusal is the only thing that says a try was wrong, so it is the only
  // thing that empties the field while the desk is shut — and one left full
  // after it would be a guess left on the screen of a locked desk.
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
      // Nothing on the sheet takes the keyboard from the field. A press is
      // still a press — the button submits on its click — it just leaves the
      // focus where it was, and so does Tab, which has nowhere else to go.
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
      <div className={contentStyles}>
        <LockClock />
        <div className={entryStyles}>
          <form
            className={formStyles({ shaken: shaken(refusals), wrong })}
            onSubmit={(event) => {
              // The page is the desktop and has nowhere to navigate to; a
              // submit that reloaded it would throw away the connection this
              // shell is drawn over.
              event.preventDefault();
              // One out at a time, which is also what the compositor allows:
              // a second offered while the first is being checked is dropped
              // there unchecked.
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
              // Held as it was sent until the compositor answers, so what is
              // being checked is what is on the screen.
              readOnly={checking}
              ref={field}
              rounded
              size="lg"
              // The one attribute between a lock screen and a billboard: the
              // screen of a locked desk is the screen somebody else is
              // standing in front of.
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
      </div>
    </div>
  );
};

// Over everything, including the panels: the launcher and the clipboard are
// `modal`, and a lock screen underneath an open launcher would be a locked desk
// somebody could still type a path into. `lock` is the preset's token for that
// one layer. One sheet for the whole desktop rather than one per screen, for the
// wallpaper's reason — the page spans every display, so `position: fixed` is the
// desktop.
//
// The desktop under it in full color and out of focus, rather than a shutter:
// the blur is what keeps it unreadable, and a shade richer is what keeps it
// looking like the desk somebody left rather than a gray wall. A light veil and
// a vignette are what make the clock legible over whatever was on the screen.
//
// It comes and goes by the blur as much as by the fade — the desktop slides out
// of focus as the sheet comes up and back into it as the sheet goes — and
// `display` is carried through the fade out (`allow-discrete`) so the sheet is
// only taken out of the layout once there is nothing of it left to see.
const sheetStyles = center({
  _starting: {
    backdropFilter: "blur(0) saturate(100%)",
    opacity: 0,
  },
  "&[inert]": {
    backdropFilter: "blur(0) saturate(100%)",
    display: "none",
    opacity: 0,
  },
  backdropFilter: "blur({spacing.16}) saturate(160%)",
  backgroundColor: "color-mix(in oklab, {colors.background} 20%, transparent)",
  backgroundImage:
    "radial-gradient(ellipse at center, transparent 40%, color-mix(in oklab, {colors.background} 50%, transparent))",
  inset: 0,
  opacity: 1,
  position: "fixed",
  transition:
    "opacity {durations.slowest} {easings.out}, backdrop-filter {durations.slowest} {easings.out}, display {durations.slowest} allow-discrete",
  zIndex: "lock",
});

// The clock and the field rise into place as the desktop blurs away, and sink
// back as it comes into focus again.
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
  opacity: 1,
  transform: "none",
  transition:
    "opacity {durations.slowest} {easings.out}, transform {durations.slowest} {easings.emphasized}",
});

// Under the pane rather than in the column, so a refusal said and taken back
// does not move the clock.
const entryStyles = css({
  position: "relative",
});

// A pane of the library's glass — see `ModalDialog`'s glass surface — around
// the field and its button, with the line of light along its top edge that a
// pane catches. The field is part of the pane rather than a card sitting on
// it, as in the file picker's.
//
// A refused passphrase shakes it, the way a head does, and edges it in
// `danger` until somebody types again. Two keyframes of the same shake, taken
// in turn, because an animation whose name does not change does not run
// again — see `shaken`.
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

/** Which of the two shakes the pane is on, for the {@link refusals}th refusal. */
const shaken = (refusals: number): "never" | "once" | "again" => {
  if (refusals === 0) {
    return "never";
  } else {
    return refusals % 2 === 1 ? "once" : "again";
  }
};
