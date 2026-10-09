// The focus state a title bar shows.
//
// Follows sway's client colors:
// - `focused`: has the keyboard.
// - `selected` (sway `focused_inactive`): an open tab of an unfocused
//   container, or an unfocused window in the `focus parent` selection.
// - `resting` (sway `unfocused`): everything else.
// - `leaf`: the focused window inside a `focus parent` selection (not in sway).
// - `urgent`: asked for the keyboard (see `WindowState.urgent`).
//
// A tab ignores the selection: its tab strip shows it instead (`TitleBar`).
//
// A string union, not an enum, because these are Panda `cva` variant keys.

export type TitleFocus = "focused" | "leaf" | "resting" | "selected" | "urgent";

type Marks = {
  /** Whether this window has keyboard focus. */
  hasKeyboard: boolean;
  /**
   * Whether it is a visible window inside the container `focus parent`
   * selected. Hidden tabs never are.
   */
  inSelection: boolean;
  /** Whether it is a tab of a tabbed or stacking container. */
  isTab: boolean;
  /** Whether it is the open tab of a tabbed or stacking container. */
  shownByContainer: boolean;
  /** Whether it asked for the keyboard and has not been worked in since. */
  urgent: boolean;
};

export const titleFocus = ({
  hasKeyboard,
  inSelection,
  isTab,
  shownByContainer,
  urgent,
}: Marks): TitleFocus => {
  const marked = inSelection && !isTab;
  if (hasKeyboard) {
    return marked ? "leaf" : "focused";
  } else if (urgent) {
    return "urgent";
  } else if (shownByContainer || marked) {
    return "selected";
  } else {
    return "resting";
  }
};
