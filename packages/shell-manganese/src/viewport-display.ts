import type {
  Display,
  DisplaySource,
} from "@domicile/component-library/display-source";

/** What the one display is called where the page is the only screen there is. */
const PAGE = "page";

/**
 * The window as the whole desktop, for a shell with no host to describe one.
 *
 * A `<Screen>` renders nothing until the desktop is described, which is right —
 * a region for a screen nobody has mentioned is a guess about where things are.
 * So the case where nothing ever will describe one needs an answer rather than
 * a fallback: opened in a plain browser for styling work there is no compositor
 * to ask, and the window is the only geometry there is.
 *
 * The same answer the compositor gives to the same question. With no displays
 * configured it describes its own window as a single display, because a desktop
 * has to be *somewhere* — this is that, one process further out.
 *
 * Re-described on every resize, for the same reason the compositor re-describes
 * on one: the desktop is the window, so a window that changed is a desktop that
 * changed.
 */
export const viewportDisplays = (view: Window): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this when it mounts, and a
    // window built at import time is not the window at that point.
    return [displayOf(view)];
  },
  onDisplays: (handler) => {
    const resized = () => {
      handler([displayOf(view)]);
    };
    view.addEventListener("resize", resized);
    return () => {
      view.removeEventListener("resize", resized);
    };
  },
});

/**
 * The window as a display.
 *
 * `innerWidth`/`innerHeight` rather than the screen's: what a `<Screen>`
 * positions against is the page's coordinate space, which is the viewport's.
 */
const displayOf = (view: Window): Display => ({
  name: PAGE,
  position: [0, 0],
  scale: view.devicePixelRatio,
  size: [view.innerWidth, view.innerHeight],
});
