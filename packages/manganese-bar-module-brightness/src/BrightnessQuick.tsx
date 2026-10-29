import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { SharedBacklight } from "@domicile-desktop/system-backlight/shared-backlight";
import { SunHorizonIcon } from "@phosphor-icons/react/dist/ssr/SunHorizon";

import { BrightnessSlider } from "./BrightnessSlider";
import type { NightLight } from "./night-light";
import { useBrightness } from "./useBrightness";

/**
 * The quick settings brightness slider. Nothing until the backlight has a
 * level, and nothing on a machine without one.
 */
export const BrightnessRow = ({
  backlight,
}: {
  backlight: SharedBacklight;
}) => {
  const control = useBrightness(backlight);
  return control === undefined ? undefined : (
    <BrightnessSlider control={control} />
  );
};

/** The quick settings switch for the night light. */
export const NightLightTile = ({ nightLight }: { nightLight: NightLight }) => {
  const on = useSharedWatch(nightLight.on) ?? false;
  return (
    <QuickToggle
      icon={<SunHorizonIcon size={16} weight={on ? "fill" : "bold"} />}
      label="Night light"
      onPressedChange={nightLight.toggle}
      pressed={on}
    />
  );
};
