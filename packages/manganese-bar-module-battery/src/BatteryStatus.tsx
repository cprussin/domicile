import type { Option } from "@cprussin/option-result";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { Battery as BatteryReading } from "@domicile-desktop/system-battery/battery";

import { cva } from "../styled-system/css";
import { DANGEROUS_PERCENT } from "./low-charge";

/**
 * The battery's charge in words, with how long it lasts, for the quick
 * settings panel. Red while low. Nothing on a machine without a battery.
 */
export const BatteryStatus = ({
  battery,
}: {
  battery: SharedWatch<Option<BatteryReading>>;
}) => {
  const reading = useSharedWatch(battery)?.match({
    None: () => undefined,
    Some: (found) => found,
  });
  if (reading === undefined) {
    return undefined;
  } else {
    const percent = Math.round(reading.charge * 100);
    const low = !reading.charging && percent <= DANGEROUS_PERCENT;
    return (
      <span className={statusStyles({ low })}>
        {[
          low ? `Battery low: ${percent}%` : `Battery ${percent}%`,
          ...remarkOf(reading),
        ].join(", ")}
      </span>
    );
  }
};

/** What follows the charge: the charger, or the time left when known. */
const remarkOf = (reading: BatteryReading): string[] => {
  if (reading.charging) {
    return ["plugged in"];
  } else if (reading.secondsLeft === undefined) {
    return [];
  } else {
    return [`about ${durationOf(reading.secondsLeft)} left`];
  }
};

const durationOf = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  } else {
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
};

const statusStyles = cva({
  base: { fontSize: "xs" },
  variants: {
    low: {
      false: {},
      true: { color: "danger" },
    },
  },
});
