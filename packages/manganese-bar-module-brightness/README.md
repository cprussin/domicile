# @domicile-desktop/manganese-bar-module-brightness

A manganese bar item: the screen brightness, its slider and the night light,
with automatic brightness.

## Use

Put `<Brightness />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Brightness } from "@domicile-desktop/manganese-bar-module-brightness";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Brightness key="brightness" />] },
});
```

It takes no props. It reads `useDomicile()`; the backlight is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Automatic brightness and night light

Run both once, on the desktop's page, as manganese's `Desktop` does:

```tsx
useAutoBrightness(domicile, true);
useNightLight(domicile, {
  from: "22:00",
  schedule: "sunset to sunrise",
  to: "07:00",
  warmth: 50,
});
```

- **Automatic brightness** (`src/auto-brightness.ts`) follows iio-sensor-proxy's
  ambient light, as macOS does:
  - The level is `0.1 + 0.225·log10(1 + lux)`: dim in the dark, about half at
    100 lux, full in daylight.
  - It eases there by 1% every 100ms, and ignores changes under 3%.
  - A level the user sets (slider, wheel or keys) shifts the curve by the
    difference, kept in `localStorage` (`auto-brightness:v1`).
  - Does nothing without a sensor or a backlight.
- **Night light** (`src/night-light.ts`) tints every monitor through
  `setColorTemperature`:
  - Sunset to sunrise at the time zone's principal city
    (`src/zone-coordinates.ts`, from the tz database by
    `bun scripts/zone-coordinates.ts /usr/share/zoneinfo`). No location
    permission. A zone without a city, such as UTC, or a day without a sunset
    keeps to the custom hours.
  - Warms over the half hour after the start and cools over the half hour
    before the end.
  - Warmth 0 to 100 is 6000K to 2000K, even in mireds.
  - The bar's switch overrides the schedule until its next change. See
    [TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#brightness).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-brightness
```
