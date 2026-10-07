import type { Meter } from "@domicile-desktop/system-audio/audio";
import type {
  Levels,
  Meters,
  SoundServer,
} from "@domicile-desktop/system-audio/sound-server";

/** One open mixer: the ids it meters and where their levels go. */
type Mixer = {
  wanted: ReadonlyMap<string, Meter>;
  onLevels: (levels: Levels) => void;
};

/**
 * Shares `meters` among every open mixer, so a device shown in two mixers is
 * recorded once. The meters run while any mixer is open.
 */
export const sharedMeters = (
  meters: SoundServer["meters"],
): SoundServer["meters"] => {
  const mixers = new Set<Mixer>();
  const state: { running: Meters | undefined } = { running: undefined };
  const sync = () => {
    if (mixers.size === 0) {
      state.running?.stop();
      state.running = undefined;
    } else {
      state.running ??= meters((levels) => {
        tell(mixers, levels);
      });
      state.running.meter(
        new Map([...mixers].flatMap(({ wanted }) => [...wanted])),
      );
    }
  };
  return (onLevels) => {
    const mixer: Mixer = { onLevels, wanted: new Map() };
    mixers.add(mixer);
    sync();
    return {
      meter: (wanted) => {
        mixer.wanted = wanted;
        sync();
      },
      stop: () => {
        mixers.delete(mixer);
        sync();
      },
    };
  };
};

/** Hands each mixer the levels of the ids it meters, if any. */
const tell = (mixers: ReadonlySet<Mixer>, levels: Levels) => {
  for (const { onLevels, wanted } of mixers) {
    const its = new Map([...levels].filter(([id]) => wanted.has(id)));
    if (its.size > 0) {
      onLevels(its);
    }
  }
};
