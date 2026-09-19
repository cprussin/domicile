// The desktop as the page last drew it.
//
// Nothing announces that a window has closed or that a workspace has been
// switched away from: the reduction that does either does it everywhere at
// once, and what is left is the state as it now is. So the only place those
// facts survive is the difference between two renders, and this is the half of
// that difference the page has to keep. `closing.ts` and `workspace-switch.ts`
// are what read it.

import type { Placement } from "./placement";
import type { Tab } from "./tree/frames";
import type { ShellWindow } from "./window";

export type Shown = {
  /** The window the keyboard was in. */
  activeId: string | undefined;
  /** The workspace that was on screen. */
  current: string;
  placements: readonly Placement[];
  tabs: readonly Tab[];
  windows: readonly ShellWindow[];
};
