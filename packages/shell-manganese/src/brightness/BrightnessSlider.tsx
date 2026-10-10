import { Slider } from "@domicile-desktop/component-library/Slider";
import { LightbulbIcon } from "@phosphor-icons/react/dist/ssr/Lightbulb";
import { LightbulbFilamentIcon } from "@phosphor-icons/react/dist/ssr/LightbulbFilament";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { BrightnessControl } from "./useBrightness";

/** The brightness slider between an unlit and a lit bulb, with the percentage. */
export const BrightnessSlider = ({
  control,
}: {
  control: BrightnessControl;
}) => {
  const percent = Math.round(control.shown * 100);
  return (
    <span className={rowStyles}>
      <LightbulbIcon size={13} />
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
      <LightbulbFilamentIcon size={15} />
      <span className={percentStyles}>{percent}%</span>
    </span>
  );
};

const rowStyles = hstack({
  gap: 2,
  inlineSize: "100%",
});

// 10px to match the bar and the battery figures; no font-size token fits.
const percentStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  minInlineSize: 6,
  textAlign: "end",
});
