import { Popover } from "@domicile-desktop/component-library/Popover";
import { Slider } from "@domicile-desktop/component-library/Slider";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { SunDimIcon } from "@phosphor-icons/react/dist/ssr/SunDim";
import type { WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { watchBrightness } from "./watch-brightness";

/** How far one wheel notch over the icon moves the brightness. */
const WHEEL_STEP = 0.05;

type Props = {
  /** The host that reports the level and sets new ones. */
  domicile: DomicileHost;
  /** Injectable so tests can drive their own backlight. */
  watch?: typeof watchBrightness | undefined;
};

/**
 * The brightness control on the bar: a sun icon that reflects the level,
 * opens a slider, and responds to the wheel.
 *
 * Changes go through the compositor to logind, and the slider shows the level
 * the host reports back, as the theme toggle does. During a drag it holds the
 * pointer's value, since replies to earlier requests arrive late.
 *
 * Draws nothing until the host reports a level, so a desktop with no backlight
 * (such as an external monitor) shows no slider.
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

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. This uses the bar's white, like the bell and
// theme toggle.
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

// 10px to match the bar and the battery figures; no font-size token fits.
const percentStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 6,
  textAlign: "end",
});

/** The sun icon's three brightness steps. */
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

/** A sun whose style follows the level: dotted, rayed, then filled. */
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

/** One wheel notch from `level`, rounded to a percent and clamped to 0–1. */
const stepped = (level: number, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(1, Math.max(0, Math.round((level + step) * 100) / 100));
};
