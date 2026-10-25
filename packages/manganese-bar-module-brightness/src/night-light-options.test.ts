import { describe, expect, it } from "bun:test";

import type { NightLightOptions } from "./night-light-options";
import { nightLightSettings } from "./night-light-options";
import { Schedule } from "./night-light-schedule";

const OPTIONS: NightLightOptions = {
  from: "22:00",
  schedule: "sunset to sunrise",
  to: "07:30",
  warmth: 40,
};
const HOURS = { from: 22 * 60, to: 7 * 60 + 30 };

describe("nightLightSettings", () => {
  it("follows the sun in the time zone's city", () => {
    expect(nightLightSettings(OPTIONS, "America/Los_Angeles")).toEqual({
      schedule: Schedule.Sun([34.1, -118.2], HOURS),
      warmth: 40,
    });
  });

  it("keeps to the custom hours in a zone without a city", () => {
    expect(nightLightSettings(OPTIONS, "UTC").schedule).toEqual(
      Schedule.Hours(HOURS),
    );
  });

  it("keeps to the custom hours when asked", () => {
    expect(
      nightLightSettings({ ...OPTIONS, schedule: "custom" }, "Europe/Paris")
        .schedule,
    ).toEqual(Schedule.Hours(HOURS));
  });

  it("has no schedule when it is off", () => {
    expect(
      nightLightSettings({ ...OPTIONS, schedule: "off" }, "Europe/Paris")
        .schedule,
    ).toBeUndefined();
  });
});
