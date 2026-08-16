// The Electron IPC channel names the main process and the preload agree on.
// They live in their own module because the preload is bundled separately from
// the main process, so a shared literal is the only thing keeping them in sync.

/** Host → chrome: one whole JSON frame from the compositor. */
export const HOST_TO_CHROME_CHANNEL = "domicile:message";

/** Chrome → host: one whole JSON frame for the compositor. */
export const CHROME_TO_HOST_CHANNEL = "domicile:send";
