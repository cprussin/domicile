import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useEffect, useState } from "react";

import { watchAudioLevels } from "./watch-audio-levels";

/** Renewal interval in ms; shorter than the compositor's metering lease. */
const RENEW_EVERY = 1000;

/** The lowest level a meter shows, in dB. Quieter reads as empty. */
const FLOOR_DB = -60;

/**
 * Meters `ids` while mounted and returns each one's level from 0 to 1, on a dB
 * scale from {@link FLOOR_DB} to full scale.
 *
 * The request is a lease: it is renewed every `renewEvery` ms and released on
 * unmount or when `ids` change. Metering a microphone records it, so a closed
 * panel must not leave metering on. See `DomicileHost.watchAudioLevels`.
 */
export const useMeters = (
  domicile: DomicileHost,
  ids: readonly string[],
  watch: typeof watchAudioLevels = watchAudioLevels,
  renewEvery: number = RENEW_EVERY,
): ReadonlyMap<string, number> => {
  const [levels, setLevels] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  useEffect(
    () =>
      watch(domicile, (peaks) => {
        setLevels(
          new Map([...peaks].map(([id, peak]) => [id, onTheMeter(peak)])),
        );
      }),
    [domicile, watch],
  );
  // Joined so a new array with the same ids does not re-run the effect.
  const asked = ids.join("\n");
  useEffect(() => {
    const watched = asked === "" ? [] : asked.split("\n");
    domicile.watchAudioLevels(watched);
    const renewal = setInterval(() => {
      domicile.watchAudioLevels(watched);
    }, renewEvery);
    return () => {
      clearInterval(renewal);
      domicile.watchAudioLevels([]);
    };
  }, [domicile, asked, renewEvery]);
  return levels;
};

/** Converts a linear peak to a 0–1 meter position. */
const onTheMeter = (peak: number) =>
  peak <= 0
    ? 0
    : Math.min(1, Math.max(0, (20 * Math.log10(peak) - FLOOR_DB) / -FLOOR_DB));
