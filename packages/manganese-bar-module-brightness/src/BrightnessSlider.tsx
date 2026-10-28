import { Slider } from "@domicile-desktop/component-library/Slider";
import { SliderRow } from "@domicile-desktop/component-library/SliderRow";
import { LightbulbFilamentIcon } from "@phosphor-icons/react/dist/ssr/LightbulbFilament";

import type { BrightnessControl } from "./useBrightness";

/** The brightness slider after a bulb, with the percentage. */
export const BrightnessSlider = ({
  control,
}: {
  control: BrightnessControl;
}) => {
  const percent = Math.round(control.shown * 100);
  return (
    <SliderRow
      figure={`${percent.toString()}%`}
      lead={<LightbulbFilamentIcon aria-hidden size={14} />}
    >
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
    </SliderRow>
  );
};
