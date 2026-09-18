import { css, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Placement } from "./placement";
import {
  clickThroughStyles,
  closingStyles,
  edgeStyles,
  placedAt,
  restingEdgeStyles,
} from "./window-styles";

type Props = {
  /** Called once it has played all the way out and can be taken off the page. */
  onGone: () => void;
  /** The box the window had when it closed, and how it stacked. */
  placement: Placement;
  /** What the window was called, which its bar goes on saying as it goes. */
  title: string;
};

/**
 * A window that has closed, shrinking away from where it was.
 *
 * **Not the window.** The window is gone — from the list, from its workspace
 * and from the layout — and for a client's window its pixels are gone with it:
 * `app_closed` is the host saying the client has exited, so there is no
 * surface left to fade out. What is drawn here is the frame the window had,
 * its name still on it, which is the part of a window the page owns.
 *
 * Its own markup rather than a `TitleBar` over an `<app>`, for one reason
 * each. The bar has a close button, and a control a keyboard can still reach
 * on a window that no longer exists is a control that does nothing. And an
 * `<app>` left on the page after its client has gone is a window the SDK goes
 * on measuring and offering to the host, which knows no such app.
 *
 * It takes no pointer, so a press in the fraction of a second it is on screen
 * for reaches whatever the desktop has put in its place.
 */
export const ClosingWindow = ({
  onGone,
  placement: { bar, depth, id, surface },
  title,
}: Props) => (
  <>
    <div
      aria-hidden
      className={cx(
        ghostBarStyles,
        edgeStyles,
        restingEdgeStyles,
        closingStyles,
        clickThroughStyles,
      )}
      // Which window is leaving, which is the desktop's own state and worth
      // being able to read off the element the way `data-window` is.
      data-closing={id}
      // On the bar rather than on the contents, because every window has one:
      // a window a tabbed container was hiding closes with no contents to take
      // away, and the desktop still has to hear that this one has finished.
      onAnimationEnd={onGone}
      style={placedAt(bar, depth)}
    >
      <span className={titleStyles}>{title}</span>
    </div>
    {surface !== undefined && (
      <div
        aria-hidden
        className={cx(
          ghostSurfaceStyles,
          edgeStyles,
          restingEdgeStyles,
          closingStyles,
          clickThroughStyles,
        )}
        data-closing={id}
        style={placedAt(surface, depth)}
      />
    )}
  </>
);

// The resting bar of the window that was: filled rather than see-through,
// because what it stands in for is no longer drawing anything of its own.
const ghostBarStyles = hstack({
  backgroundColor: "card",
  borderBlockEndWidth: 0,
  color: "muted",
  gap: 2,
  justify: "space-between",
  overflow: "hidden",
  paddingInlineStart: 3,
});

// And the contents under it, which meet the bar flush the way a window's do.
const ghostSurfaceStyles = css({
  backgroundColor: "card",
  borderBlockStartWidth: 0,
});

const titleStyles = css({
  // The same off-scale size a live window's bar is titled at.
  fontSize: "0.6875rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
