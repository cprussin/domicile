import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { Popover } from "@domicile/component-library/Popover";
import { Slider } from "@domicile/component-library/Slider";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { SunDimIcon } from "@phosphor-icons/react/dist/ssr/SunDim";
import type { CSSProperties, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { watchBrightness } from "./watch-brightness";

/** How far one notch of the wheel over the icon moves the brightness. */
const WHEEL_STEP = 0.05;

type Props = {
  /** Where the level comes from and where a new one is asked for. */
  domicile: DomicileClient;
  /** How it is watched; injected so tests can drive a backlight of their own. */
  watch?: typeof watchBrightness | undefined;
};

/**
 * The screen's brightness, on the bar: a sun ringed by the level, which opens
 * a slider — and which the wheel turns without opening anything.
 *
 * **The slider follows the desk, not its own drag.** A move asks the
 * compositor, which asks logind, and what comes back is the level every chrome
 * is told — the same one-path arrangement the theme toggle has. While a drag
 * is under way the slider holds where the pointer is, because the answers to
 * the drag's own earlier requests arrive behind it; once it is let go the next
 * reading is the truth again, a brightness key's included.
 *
 * Nothing is drawn until the host has said a level, which on a desktop with
 * no backlight — an external monitor — is never: no slider rather than one
 * that moves nothing.
 */
export const Brightness = ({ domicile, watch = watchBrightness }: Props) => {
  const [reading, setReading] = useState<number | undefined>(undefined);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const dragging = useRef(false);

  useEffect(
    () =>
      watch(domicile, (level) => {
        setReading(level);
        if (!dragging.current) {
          setHeld(undefined);
        }
      }),
    [domicile, watch],
  );

  if (reading === undefined) {
    return undefined;
  } else {
    const shown = held ?? reading;
    const percent = Math.round(shown * 100);
    const ask = (level: number) => {
      setHeld(level);
      domicile.setBrightness(level);
    };
    return (
      <Popover
        align="end"
        side="bottom"
        title={
          <span className={headerStyles}>
            <span className={glowStyles} style={levelOf(shown)}>
              <SunIcon size={18} weight="fill" />
            </span>
            <span className={titleStyles}>Brightness</span>
            <span className={percentStyles}>{percent}%</span>
          </span>
        }
        trigger={
          <button
            aria-label={`Brightness ${percent}%`}
            className={triggerStyles}
            onWheel={(event) => {
              ask(stepped(shown, event));
            }}
            style={levelOf(shown)}
            type="button"
          >
            <SunDimIcon size={14} weight="bold" />
          </button>
        }
      >
        <span className={rowStyles}>
          <SunDimIcon size={14} />
          <Slider
            label="Brightness"
            max={100}
            min={0}
            onValueChange={(value) => {
              dragging.current = true;
              ask(value / 100);
            }}
            onValueCommitted={() => {
              dragging.current = false;
            }}
            step={1}
            value={percent}
          />
          <SunIcon size={18} />
        </span>
      </Popover>
    );
  }
};

// THE BAR'S BUTTON, AND NOT THE LIBRARY'S. `Button`'s ghost letters itself in
// `muted`, which over a photograph is gray on whatever the picture is; this
// bar is lettered white, and this takes the bar's color the way the workspace
// chips and the theme toggle do.
//
// THE RING IS THE READING. A conic sweep of `--level` turns, masked down to a
// rim, so the bar says how bright the screen is without being opened — the
// battery's fill makes the same choice for the same reason.
const triggerStyles = css({
  _hover: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 10%, transparent)",
  },
  "&::before": {
    backgroundImage:
      "conic-gradient(currentcolor calc(var(--level) * 1turn), color-mix(in oklab, currentcolor 25%, transparent) 0)",
    borderRadius: "full",
    content: '""',
    inset: 0.5,
    maskImage:
      "radial-gradient(farthest-side, transparent calc(100% - {spacing.0.5}), black calc(100% - {spacing.0.5}))",
    position: "absolute",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  position: "relative",
  transition: "background-color {durations.fast} {easings.default}",
});

const headerStyles = hstack({
  gap: 2,
  inlineSize: 64,
});

// A sun that brightens with the screen: larger, and haloed in the accent, as
// `--level` climbs.
const glowStyles = css({
  color: "accent",
  display: "inline-flex",
  filter: "drop-shadow(0 0 calc(var(--level) * {spacing.2}) {colors.accent})",
  scale: "calc(0.8 + var(--level) * 0.35)",
  transition:
    "scale {durations.normal} {easings.outBack}, filter {durations.normal} {easings.out}",
});

const titleStyles = css({
  flexGrow: 1,
});

const percentStyles = css({
  color: "foreground",
  fontSize: "xl",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "semibold",
  letterSpacing: "tight",
  lineHeight: "tight",
});

const rowStyles = hstack({
  color: "muted",
  gap: 2.5,
  inlineSize: "100%",
  paddingBlock: 1,
});

/**
 * The level as a custom property, which the ring and the glow are drawn off.
 * Not a token, for the battery fill's reason: it is the reading itself.
 */
const levelOf = (level: number): CSSProperties =>
  // `CSSProperties` has no index for custom properties; this is the one key.
  ({ "--level": level }) as CSSProperties;

/** A notch of the wheel from `level`, rounded to the percent and kept in range. */
const stepped = (level: number, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(1, Math.max(0, Math.round((level + step) * 100) / 100));
};
