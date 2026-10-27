import { Slider } from "@domicile-desktop/component-library/Slider";
import { LightbulbFilamentIcon } from "@phosphor-icons/react/dist/ssr/LightbulbFilament";

import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";
import type { BrightnessControl } from "./useBrightness";

/** The brightness slider after a bulb, with the percentage. */
export const BrightnessSlider = ({
  control,
}: {
  control: BrightnessControl;
}) => {
  const percent = Math.round(control.shown * 100);
  return (
    <span className={rowStyles}>
      <span aria-hidden className={iconStyles}>
        <LightbulbFilamentIcon size={14} />
      </span>
      <Slider
        label="Brightness"
        max={100}
        min={0}
        onValueChange={(value) => {
          control.drag(value / 100);
        }}
        onValueCommitted={control.dropped}
        step={1}
        value={percent}
      />
      <span className={percentStyles}>{percent}%</span>
    </span>
  );
};

const rowStyles = hstack({
  gap: 2,
  inlineSize: "100%",
});

// As wide as the volume's mute button, so the two sliders start together.
const iconStyles = css({
  alignItems: "center",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
});

// The same figure style as volume's, so the two line up.
const percentStyles = css({
  color: "color-mix(in oklab, currentcolor 75%, transparent)",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 9,
  textAlign: "end",
});
