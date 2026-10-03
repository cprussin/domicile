import { Popover } from "@domicile-desktop/component-library/Popover";
import { Slider } from "@domicile-desktop/component-library/Slider";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { SunDimIcon } from "@phosphor-icons/react/dist/ssr/SunDim";
import type { WheelEvent } from "react";
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
 * The screen's brightness, on the bar: a sun drawn brighter as the screen is,
 * which opens a slider in a pill hung off the bar — and which the wheel turns
 * without opening anything.
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
        align="center"
        side="bottom"
        tone="overPhoto"
        trigger={
          <button
            aria-label={`Brightness ${percent}%`}
            className={triggerStyles}
            data-intensity={intensityOf(shown)}
            onWheel={(event) => {
              ask(stepped(shown, event));
            }}
            type="button"
          >
            <Sun level={shown} />
          </button>
        }
      >
        <span className={rowStyles}>
          <SunDimIcon size={13} />
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
          <SunIcon size={15} />
          <span className={percentStyles}>{percent}%</span>
        </span>
      </Popover>
    );
  }
};

// THE BAR'S BUTTON, AND NOT THE LIBRARY'S. `Button`'s ghost letters itself in
// `muted`, which over a photograph is gray on whatever the picture is; this
// bar is lettered white, and this takes the bar's color the way the
// notification bell and the theme toggle do.
const triggerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
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
  transition: "background-color {durations.fast} {easings.default}",
});

const rowStyles = hstack({
  gap: 2,
  inlineSize: 60,
});

// Ten pixels, the bar's own size, which no font-size token is — see the
// battery's figures, which this sits beside in spirit.
const percentStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 6,
  textAlign: "end",
});

/** How bright the sun on the bar is drawn: three steps of one icon. */
type Intensity = "dim" | "half" | "full";

const intensityOf = (level: number): Intensity => {
  if (level < 1 / 3) {
    return "dim";
  } else if (level < 2 / 3) {
    return "half";
  } else {
    return "full";
  }
};

/**
 * A plain sun whose weight follows the level — dotted when dim, rayed, then
 * filled — so the bar says roughly how bright the screen is without a figure.
 */
const Sun = ({ level }: { level: number }) => {
  switch (intensityOf(level)) {
    case "dim":
      return <SunDimIcon size={15} weight="bold" />;
    case "half":
      return <SunIcon size={15} weight="bold" />;
    case "full":
      return <SunIcon size={15} weight="fill" />;
  }
};

/** A notch of the wheel from `level`, rounded to the percent and kept in range. */
const stepped = (level: number, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(1, Math.max(0, Math.round((level + step) * 100) / 100));
};
