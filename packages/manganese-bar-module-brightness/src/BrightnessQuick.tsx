import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { SharedBacklight } from "@domicile-desktop/system-backlight/shared-backlight";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";

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

/** The quick settings tile for the night light. */
export const NightLightTile = ({ nightLight }: { nightLight: NightLight }) => {
  const on = useSharedWatch(nightLight.on) ?? false;
  return (
    <QuickTile
      detail={on ? "On" : "Off"}
      icon={<MoonIcon size={15} weight={on ? "fill" : "bold"} />}
      label="Night light"
      onPressedChange={nightLight.toggle}
      pressed={on}
    />
  );
};
