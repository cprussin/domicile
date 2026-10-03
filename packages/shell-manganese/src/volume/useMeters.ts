import type { DomicileClient } from "@domicile/sdk/domicile-client";
import { useEffect, useState } from "react";

import { watchAudioLevels } from "./watch-audio-levels";

/** How often the ask is renewed: well inside the compositor's lease. */
const RENEW_EVERY = 1000;

/** The quietest a meter shows, in decibels: anything below is empty. */
const FLOOR_DB = -60;

/**
 * Meter `ids` while this is mounted, and read each one's level — 0 through 1
 * of the meter, in decibels from {@link FLOOR_DB} to full scale, which is how
 * a meter reads loud and quiet alike.
 *
 * **The ask is a lease**: renewed every second, and let go of when this
 * unmounts or the ids change — metering a microphone records it, and a panel
 * that shut must not leave it recording. See `watchAudioLevels` on the client.
 *
 * `watch` and `renewEvery` are injected so a test can drive the meters and
 * wait out a renewal.
 */
export const useMeters = (
  domicile: DomicileClient,
  ids: readonly string[],
  watch: typeof watchAudioLevels = watchAudioLevels,
  renewEvery: number = RENEW_EVERY,
): ReadonlyMap<string, number> => {
  const [levels, setLevels] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  useEffect(
    () =>
      watch(domicile, (message) => {
        setLevels(
          new Map(
            [...message.levels].map(([id, peak]) => [id, onTheMeter(peak)]),
          ),
        );
      }),
    [domicile, watch],
  );
  // One string, so an array that is new each render but says the same thing
  // asks nothing again.
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

/** A linear peak as a point on the meter. */
const onTheMeter = (peak: number) =>
  peak <= 0
    ? 0
    : Math.min(1, Math.max(0, (20 * Math.log10(peak) - FLOOR_DB) / -FLOOR_DB));
