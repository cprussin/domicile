import { Slider } from "@domicile-desktop/component-library/Slider";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { SunDimIcon } from "@phosphor-icons/react/dist/ssr/SunDim";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { BrightnessControl } from "./useBrightness";

/** The brightness slider between a dim and a bright sun, with the percentage. */
export const BrightnessSlider = ({
  control,
}: {
  control: BrightnessControl;
}) => {
  const percent = Math.round(control.shown * 100);
  return (
    <span className={rowStyles}>
      <SunDimIcon size={13} />
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
      <SunIcon size={15} />
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
