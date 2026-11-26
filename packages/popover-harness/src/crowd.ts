import type { ComponentType } from "react";

/** A bar popover with more in it than a small screen holds. */
export type Crowd = {
  /** Names it in the harness's command line and the story's `crowd` arg. */
  id: string;
  /**
   * The buttons pressed, in turn, to show the panel: its trigger, then any
   * row that opens the crowded part.
   */
  presses: readonly string[];
  /**
   * A row's disclosure in the open panel, such as "Details". The harness opens
   * and shuts its drawer, and fails when the drawer's height jumps rather than
   * following it.
   */
  drawer?: string | undefined;
  /** Text in the panel's last row, which must scroll into view. */
  last: string;
  /**
   * Buttons and menu items pressed, in turn, to put the open panel in another
   * state and back, such as paused, which must move nothing in it.
   */
  toggle?: { on: readonly string[]; off: readonly string[] } | undefined;
  /** Draws its bar along the top of the screen. */
  Scene: ComponentType;
};
