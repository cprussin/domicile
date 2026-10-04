import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { AudioLevelsMessage } from "@domicile-desktop/sdk/host-message";

import { watchShared } from "../host/watch-shared";

/**
 * Calls `onLevels` with each meter update (about 20 per second while anything
 * is metered). Returns an unsubscribe function.
 *
 * Choosing what to meter is separate; see `useMeters`. The subscription is
 * shared across bars; see `watchShared`.
 */
export const watchAudioLevels = (
  domicile: DomicileClient,
  onLevels: (levels: AudioLevelsMessage) => void,
): (() => void) => watchShared(domicile, "audio_levels", onLevels);
