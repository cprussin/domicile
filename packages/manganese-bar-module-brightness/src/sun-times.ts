// Sunrise and sunset, from the sunrise equation. Within about two minutes
// away from the poles, which is plenty for a night light. See
// https://en.wikipedia.org/wiki/Sunrise_equation.

import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";

/** A place, as [latitude, longitude] in degrees, north and east positive. */
export type Place = readonly [number, number];

/** When the sun rises and sets on one day. */
export type SunTimes = { readonly sunrise: Date; readonly sunset: Date };

const DAY_MS = 86_400_000;
/** The Julian day of the Unix epoch. */
const UNIX_EPOCH = 2_440_587.5;
/** The Julian day of noon on 2000-01-01. */
const J2000 = 2_451_545;
/** The Earth's axial tilt. */
const TILT = 23.4397;
/** The sun's altitude at sunrise: its radius, plus the air's refraction. */
const HORIZON = -0.833;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * The sunrise and sunset at `place` on the calendar day `year`, `month` (0
 * for January) and `day`, or none on a day the sun neither rises nor sets.
 */
export const sunTimes = (
  year: number,
  month: number,
  day: number,
  [latitude, longitude]: Place,
): Option<SunTimes> => {
  const days = Math.round(
    Date.UTC(year, month, day, 12) / DAY_MS + UNIX_EPOCH - J2000,
  );
  const meanNoon = days - longitude / 360;
  const anomaly = (357.5291 + 0.985_600_28 * meanNoon) % 360;
  const m = toRadians(anomaly);
  const center =
    1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const ecliptic = toRadians((anomaly + center + 180 + 102.9372) % 360);
  const transit =
    J2000 + meanNoon + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * ecliptic);
  const declination = Math.asin(Math.sin(ecliptic) * Math.sin(toRadians(TILT)));
  const phi = toRadians(latitude);
  const cosHourAngle =
    (Math.sin(toRadians(HORIZON)) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (Math.abs(cosHourAngle) > 1) {
    return None();
  } else {
    const half = toDegrees(Math.acos(cosHourAngle)) / 360;
    return Some({
      sunrise: fromJulian(transit - half),
      sunset: fromJulian(transit + half),
    });
  }
};

const fromJulian = (julian: number): Date =>
  new Date((julian - UNIX_EPOCH) * DAY_MS);
