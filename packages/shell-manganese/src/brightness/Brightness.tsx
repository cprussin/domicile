import { Popover } from "@domicile-desktop/component-library/Popover";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { SunDimIcon } from "@phosphor-icons/react/dist/ssr/SunDim";
import type { WheelEvent } from "react";

import { css } from "../../styled-system/css";
import { BrightnessSlider } from "./BrightnessSlider";
import { hostBacklight } from "./host-backlight";
import { useBrightness } from "./useBrightness";

/** How far one wheel notch over the icon moves the brightness. */
const WHEEL_STEP = 0.05;

type Props = {
  /** The desktop whose system calls reach the backlight. */
  domicile: DomicileHost;
  /** Injectable so tests can drive their own backlight. */
  backlight?: typeof hostBacklight | undefined;
};

/**
 * The brightness control on the bar: a sun icon that reflects the level,
 * opens a slider, and responds to the wheel. See {@link useBrightness}.
 */
export const Brightness = ({ backlight = hostBacklight, domicile }: Props) => {
  const control = useBrightness(domicile, backlight);

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
            <Sun level={control.shown} />
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
