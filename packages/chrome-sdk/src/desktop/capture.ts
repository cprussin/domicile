// Pictures of the desk: a screenshot or a screen recording through the shell's
// dialog, and a window's last frame for a picker.

import type { System } from "../system";

export type Capture = {
  screenshot: System["screenshot"];
  /** Record what the shell's dialog picks; see {@link System.screenRecord}. */
  screenRecord: System["screenRecord"];
  /** A window as it last drew itself, as a `data:` URL of a PNG. */
  preview: System["previewWindow"];
};

export const capture = (
  calls: Pick<System, "previewWindow" | "screenRecord" | "screenshot">,
): Capture => ({
  preview: (window) => calls.previewWindow(window),
  screenRecord: () => calls.screenRecord(),
  screenshot: () => calls.screenshot(),
});
