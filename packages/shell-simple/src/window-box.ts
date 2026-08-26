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
 * `size` is absent for a client that has not drawn yet, which is every client
 * at the moment it is announced: a toplevel maps before it draws, and how big
 * a Wayland client wants to be is something it says by drawing. What arrives
 * here instead is the replay a reloading chrome gets, where the size is
 * whatever the client last committed — not what this shell configured it to,
 * which is the separate `requested_size` the replay does not read, and the two
 * part company for a client that rounds its configure as a terminal snapping
 * to a cell grid does.
 *
 * A Wayland client says nothing about where it goes — `app_appeared` carries
 * no position, because placing a window is the desktop's job. This does the
 * crudest thing that stays usable: a step down and right of the window before
 * it, wrapping so a long session does not walk them off the bottom right
 * corner.
 */
export const openingBox = (
  index: number,
  size: readonly [number, number] | undefined,
): WindowBox => {
  const step = CASCADE_STEP * (index % CASCADE_LENGTH);
  const [width, height] = size ?? OPENING_SIZE;
  return { height, left: step, top: step, width };
};
