import type {
  DomicileAudioLevelsEvent,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";

/** The loudest sample since the last report, 0 through 1, by id. */
export type AudioLevels = ReadonlyMap<string, number>;

/**
 * Watch the meters' levels: `onLevels` is called each time the host says
 * them, some twenty times a second while anything is metered, and what comes
 * back stops it. What is metered is asked for separately — see `useMeters`.
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
