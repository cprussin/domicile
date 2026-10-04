import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";

/** The name of the single display when the page is the only screen. */
const PAGE = "page";

/**
 * The browser window as the whole desktop, for a shell running without a host.
 *
 * `<Screen>` renders nothing until the desktop is described. In a plain browser
 * (for example, for styling work) nothing ever describes it, so the window is
 * used as the only display. Re-described on every resize, as the compositor
 * does.
 */
export const viewportDisplays = (view: Window): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the window size at import time may be stale by
    // mount.
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
 * Uses `innerWidth`/`innerHeight` because `<Screen>` positions against the
 * viewport.
 */
const displayOf = (view: Window): Display => ({
  name: PAGE,
  position: [0, 0],
  scale: view.devicePixelRatio,
  size: [view.innerWidth, view.innerHeight],
});
