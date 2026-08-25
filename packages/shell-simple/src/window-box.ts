// Where a window sits, and where a new one opens.

/** How far each window opens down and to the right of the one before it. */
const CASCADE_STEP = 32;

/** How many windows the cascade runs for before starting over. */
const CASCADE_LENGTH = 8;

/**
 * What a window opens at when its client has not committed a size — and, in
 * practice, what that client stays at.
 *
 * The box is the shell's rather than the client's: the element configures its
 * client from the box it was measured at, and nothing here adopts the size the
 * client reports back. That is the model and not an oversight — the chrome
 * dictates how big a window is, the same way manganese's windows are the size
 * of its stage — but the cost is real. The compositor's first configure for a
 * toplevel carries no size, which is Wayland for "you choose", so a client's
 * own preference is on the wire exactly once and this drops it.
 */
const OPENING_SIZE = [640, 480] as const;

/**
 * Where a window sits on the desktop, in the CSS pixels the chrome lays out in.
 *
 * Physical rather than logical (`left`/`top`, not `insetInlineStart`): these are
 * screen coordinates a pointer is dragged through, and a pointer does not
 * change direction with the writing mode.
 */
export type WindowBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

/**
 * Where the `index`th window to appear opens, at the size its client has
 * committed to — or at {@link OPENING_SIZE}, for one that has not committed.
 *
 * A Wayland client says nothing about where it goes — `app_appeared` carries
 * no position, because placing a window is the desktop's job. This does the
 * crudest thing that stays usable: a step down and right of the window before
 * it, wrapping so a long session does not walk them off the bottom right
 * corner.
 */
export const openingBox = (
  index: number,
  size: readonly [number, number],
): WindowBox => {
  const step = CASCADE_STEP * (index % CASCADE_LENGTH);
  const [width, height] = hasCommitted(size) ? size : OPENING_SIZE;
  return { height, left: step, top: step, width };
};

/**
 * Whether the announced size is one the client has committed to.
 *
 * `app_appeared` goes out when the toplevel maps, which is before the client
 * has committed a buffer, so the compositor announces every new window as 0x0
 * and says how big it really is on the `app_resized` that follows. A nonzero
 * size means the client has committed at least once — the replay a reloading
 * chrome gets, where the size is whatever the client last committed. Not what
 * this shell configured it to: `open_apps` reads `App::size` and the chrome's
 * ask is the separate `requested_size`, and the two part company for a client
 * that rounds its configure, as a terminal snapping to a cell grid does.
 * A reload that races a client's first commit replays the 0x0 too.
 *
 * A window opened at 0x0 is invisible for the rest of its life rather than
 * merely at first: the shell tells the host that window is not visible, so
 * nothing is ever composited there, and the client is never configured to a
 * size to redraw at.
 */
const hasCommitted = ([width, height]: readonly [number, number]): boolean =>
  width > 0 && height > 0;
