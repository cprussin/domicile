import type { Meter } from "@domicile-desktop/system-audio/audio";
import type {
  Levels,
  Meters,
  SoundServer,
} from "@domicile-desktop/system-audio/sound-server";
import { useEffect, useState } from "react";

/** The lowest level a meter shows, in dB. Quieter reads as empty. */
const FLOOR_DB = -60;

/**
 * Meters `ids` while mounted and returns each one's level from 0 to 1, on a dB
 * scale from {@link FLOOR_DB} to full scale. Ids with no entry in `sources`
 * are not metered.
 *
 * Metering a microphone records it, so the meters stop on unmount.
 */
export const useMeters = (
  server: Pick<SoundServer, "meters">,
  ids: readonly string[],
  sources: ReadonlyMap<string, Meter>,
): Levels => {
  const [levels, setLevels] = useState<Levels>(() => new Map());
  const [meters, setMeters] = useState<Meters | undefined>(undefined);
  useEffect(() => {
    const running = server.meters((peaks) => {
      setLevels(
        new Map([...peaks].map(([id, peak]) => [id, onTheMeter(peak)])),
      );
    });
    setMeters(running);
    return () => {
      running.stop();
    };
  }, [server]);
  // Runs each render: `meter` changes nothing when nothing changed.
  useEffect(() => {
    meters?.meter(
      new Map(
        ids.flatMap((id) => {
          const source = sources.get(id);
          return source === undefined ? [] : [[id, source] as const];
        }),
      ),
    );
  });
  return levels;
};

/** Converts a linear peak to a 0–1 meter position. */
const onTheMeter = (peak: number) =>
  peak <= 0
    ? 0
    : Math.min(1, Math.max(0, (20 * Math.log10(peak) - FLOOR_DB) / -FLOOR_DB));
