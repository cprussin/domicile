// How a window's title bar is drawn: which of three things it says about the
// keyboard.
//
// sway's three client colors, and for its reason. `focused` is the window the
// keyboard is in, and there is exactly one of those on a desktop. `unfocused`
// is every other window. The one in between is what a tab needs: a tabbed or
// stacking container shows one of its children whether or not the keyboard is
// anywhere inside it, so the tab that is open in a container nobody is working
// in has to be marked as open without claiming the keyboard — sway calls it
// `focused_inactive`, and without it two bars on one screen would look like
// the focused window.
//
// A string union rather than an enum because these are the keys of a Panda
// `cva` variant, which is where they are read.

export type TitleFocus = "focused" | "resting" | "selected";

type Marks = {
  /** Whether this is the window the user is working in. */
  hasKeyboard: boolean;
  /**
   * Whether the container this bar belongs to is showing it — a tabbed or
   * stacking container's open tab. A window's own bar has no such question:
   * either the keyboard is in the window or it is not.
   */
  shownByContainer: boolean;
};

export const titleFocus = ({
  hasKeyboard,
  shownByContainer,
}: Marks): TitleFocus => {
  if (hasKeyboard) {
    return "focused";
  } else if (shownByContainer) {
    return "selected";
  } else {
    return "resting";
  }
};
