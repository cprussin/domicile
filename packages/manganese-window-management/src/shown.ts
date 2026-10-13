// The desktop as the page last drew it.
//
// No event reports a close or a workspace switch, so `closing.ts` and
// `workspace-switch.ts` detect them by comparing this with the next render.

import type { PlacedTab, Placement } from "./placement";
import type { ShellWindow } from "./window";

export type Shown = {
  /** The focused window. */
  activeId: string | undefined;
  /** The workspace on screen. */
  current: string;
  placements: readonly Placement[];
  /** The windows hidden in the scratchpad. */
  scratchpad: readonly string[];
  tabs: readonly PlacedTab[];
  windows: readonly ShellWindow[];
};
