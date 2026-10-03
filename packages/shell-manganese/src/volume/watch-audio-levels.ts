import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { AudioLevelsMessage } from "@domicile/chrome-sdk/host-message";

import { watchShared } from "../host/watch-shared";

/**
 * Watch the meters' levels: `onLevels` is called each time the host says
 * them, some twenty times a second while anything is metered, and what comes
 * back stops it. What is metered is asked for separately — see `useMeters`.
 *
 * Shared with every other bar on the page — see `watchShared`.
 */
export const watchAudioLevels = (
  domicile: DomicileClient,
  onLevels: (levels: AudioLevelsMessage) => void,
): (() => void) => watchShared(domicile, "audio_levels", onLevels);
