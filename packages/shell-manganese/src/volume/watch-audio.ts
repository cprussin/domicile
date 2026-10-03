import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { AudioMessage } from "@domicile-desktop/sdk/host-message";

import { watchShared } from "../host/watch-shared";

/**
 * Watch the desk's sound: `onAudio` is called with every device, stream and
 * card as soon as the host has said them and again whenever any of them moves
 * — a key, another mixer, or this shell's own sliders — and what comes back
 * stops it. A desk with no sound server never calls it.
 *
 * Shared with every other bar on the page — see `watchShared`.
 */
export const watchAudio = (
  domicile: DomicileClient,
  onAudio: (audio: AudioMessage) => void,
): (() => void) => watchShared(domicile, "audio", onAudio);
