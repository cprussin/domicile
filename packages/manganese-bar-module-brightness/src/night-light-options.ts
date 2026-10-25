// The night light's options as the config and Settings give them, and the
// settings they make.

import type { NightLightSettings } from "./night-light";
import { Schedule } from "./night-light-schedule";
import { ZONE_COORDINATES } from "./zone-coordinates";

/** The night light's options, as the shell reads them. */
export type NightLightOptions = {
  /** When it comes on by itself. */
  readonly schedule: "sunset to sunrise" | "custom" | "off";
  /** `HH:MM`, for a custom schedule. */
  readonly from: string;
  readonly to: string;
  /** 0 to 100. */
  readonly warmth: number;
};

/**
 * The settings `options` make in the time zone `zone`, which places the sun:
 * like macOS, it needs no location permission. In a zone without a city, such
 * as UTC, sunset to sunrise keeps to the custom hours.
 */
export const nightLightSettings = (
  options: NightLightOptions,
  zone: string,
): NightLightSettings => {
  const hours = { from: minutes(options.from), to: minutes(options.to) };
  const place = ZONE_COORDINATES[zone];
  return {
    schedule: scheduleOf(options.schedule, hours, place),
    warmth: options.warmth,
  };
};

const scheduleOf = (
  schedule: NightLightOptions["schedule"],
  hours: { from: number; to: number },
  place: readonly [number, number] | undefined,
): Schedule | undefined => {
  switch (schedule) {
    case "sunset to sunrise": {
      return place === undefined
        ? Schedule.Hours(hours)
        : Schedule.Sun(place, hours);
    }
    case "custom": {
      return Schedule.Hours(hours);
    }
    case "off": {
      return undefined;
    }
  }
};

/** `HH:MM` as minutes after midnight. */
const minutes = (time: string): number => {
  const [hours = "", rest = ""] = time.split(":");
  return Number(hours) * 60 + Number(rest);
};
