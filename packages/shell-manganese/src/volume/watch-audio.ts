import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { AudioMessage } from "@domicile-desktop/sdk/host-message";

import { watchShared } from "../host/watch-shared";

/**
 * Calls `onAudio` with all devices, streams and cards on the first host report
 * and on every change. Returns an unsubscribe function.
 *
 * `onAudio` is never called without a sound server. The subscription is shared
 * across bars; see `watchShared`.
 */
export const watchAudio = (
  domicile: DomicileClient,
  onAudio: (audio: AudioMessage) => void,
): (() => void) => watchShared(domicile, "audio", onAudio);
