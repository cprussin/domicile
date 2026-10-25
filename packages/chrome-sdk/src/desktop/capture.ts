// Pictures of the desk: a screenshot through the shell's dialog, and a
// window's last frame for a picker.

import type { System } from "../system";

export type Capture = {
  screenshot: System["screenshot"];
  /** A window as it last drew itself, as a `data:` URL of a PNG. */
  preview: System["previewWindow"];
};

export const capture = (
  calls: Pick<System, "previewWindow" | "screenshot">,
): Capture => ({
  preview: (window) => calls.previewWindow(window),
  screenshot: () => calls.screenshot(),
});
