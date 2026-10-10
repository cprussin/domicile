import { Popover } from "@domicile-desktop/component-library/Popover";
import { LightbulbIcon } from "@phosphor-icons/react/dist/ssr/Lightbulb";
import { LightbulbFilamentIcon } from "@phosphor-icons/react/dist/ssr/LightbulbFilament";
import type { WheelEvent } from "react";

import { css } from "../../styled-system/css";
import type { SharedBacklight } from "../readouts/readouts";
import { BrightnessSlider } from "./BrightnessSlider";
import { useBrightness } from "./useBrightness";

/** How far one wheel notch over the icon moves the brightness. */
const WHEEL_STEP = 0.05;

type Props = {
  /** The desk's backlight. */
  backlight: SharedBacklight;
};

/**
 * The brightness control on the bar: a light bulb icon that reflects the level,
 * opens a slider, and responds to the wheel. See {@link useBrightness}.
 */
export const Brightness = ({ backlight }: Props) => {
  const control = useBrightness(backlight);

  if (control === undefined) {
    return undefined;
  } else {
    const percent = Math.round(control.shown * 100);
    return (
      <Popover
        align="center"
        side="bottom"
        tone="overPhoto"
        trigger={
          <button
            aria-label={`Brightness ${percent}%`}
            className={triggerStyles}
            data-intensity={intensityOf(control.shown)}
            onWheel={(event) => {
              control.ask(stepped(control.shown, event));
            }}
            type="button"
          >
            <Bulb level={control.shown} />
          </button>
        }
      >
        <span className={panelStyles}>
          <BrightnessSlider control={control} />
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

const panelStyles = css({
  display: "block",
  inlineSize: 60,
});

/** The bulb icon's three brightness steps. */
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

/** A bulb whose style follows the level: empty, lit filament, then filled. */
const Bulb = ({ level }: { level: number }) => {
  switch (intensityOf(level)) {
    case "dim":
      return <LightbulbIcon size={15} weight="bold" />;
    case "half":
      return <LightbulbFilamentIcon size={15} weight="bold" />;
    case "full":
      return <LightbulbIcon size={15} weight="fill" />;
  }
};

/** One wheel notch from `level`, rounded to a percent and clamped to 0–1. */
const stepped = (level: number, event: WheelEvent) => {
  const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
  return Math.min(1, Math.max(0, Math.round((level + step) * 100) / 100));
};
