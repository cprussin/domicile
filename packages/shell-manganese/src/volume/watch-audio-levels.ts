import type {
  DomicileAudioLevelsEvent,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";

/** The loudest sample since the last report, 0 through 1, by id. */
export type AudioLevels = ReadonlyMap<string, number>;

/**
 * Calls `onLevels` with each meter update (about 20 per second while anything
 * is metered). Returns an unsubscribe function.
 *
 * Choosing what to meter is separate; see `useMeters`.
 */
export const watchAudioLevels = (
  domicile: DomicileHost,
  onLevels: (levels: AudioLevels) => void,
): (() => void) => {
  const heard = ({ levels }: DomicileAudioLevelsEvent) => {
    onLevels(new Map(levels.map(({ id, peak }) => [id, peak])));
  };
  domicile.addEventListener("audiolevels", heard);
  return () => {
    domicile.removeEventListener("audiolevels", heard);
  };
};
