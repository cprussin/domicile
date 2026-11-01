// Keyboard movement of a highlight through a list, while focus stays in the
// input above it. Used by the launcher, the clipboard history and the
// pickers.

/**
 * How far a key press moves the highlight, or `undefined` if it does not move
 * it. Handles the arrows, Emacs-style `ctrl+n` / `ctrl+p`, Page Up / Page Down
 * by `page` rows, and Vim-style `ctrl+d` / `ctrl+u` by half that.
 *
 * `ctrl+u` takes the key from the box, which would otherwise clear the line.
 */
export const stepOf = (
  {
    ctrlKey,
    key,
  }: {
    ctrlKey: boolean;
    key: string;
  },
  page: number,
): number | undefined => {
  switch (key) {
    case "PageDown": {
      return page;
    }
    case "PageUp": {
      return -page;
    }
    case "d": {
      return ctrlKey ? halfOf(page) : undefined;
    }
    case "u": {
      return ctrlKey ? -halfOf(page) : undefined;
    }
    case "ArrowDown": {
      return 1;
    }
    case "ArrowUp": {
      return -1;
    }
    case "n": {
      return ctrlKey ? 1 : undefined;
    }
    case "p": {
      return ctrlKey ? -1 : undefined;
    }
    default: {
      return undefined;
    }
  }
};

/** Half a page, rounded down, but at least one row so the key always moves. */
const halfOf = (page: number): number => Math.max(Math.floor(page / 2), 1);

/**
 * How many rows Page Down moves in `scroller`: the rows that fit in it whole.
 *
 * At least one, so the keys still move a list that isn't laid out, or whose
 * scroller is shorter than a row. Takes a ref's `current`, which is `null`
 * only before the list mounts, when no key can reach it.
 */
export const pageOf = (scroller: Scroller | null): number => {
  if (scroller === null) {
    throw new Error("Paged a list that is not mounted");
  } else {
    const row = scroller.querySelector('[role="option"]')?.offsetHeight ?? 0;
    return row === 0 ? 1 : Math.max(Math.floor(scroller.clientHeight / row), 1);
  }
};

/** The parts of a scrolling list element that `pageOf` measures. */
type Scroller = Pick<HTMLElement, "clientHeight"> & {
  querySelector: (selector: string) => Pick<HTMLElement, "offsetHeight"> | null;
};

/**
 * The highlighted row index, kept within the list, or none for an empty list.
 * With no key pressed it is the first row, so Enter picks it.
 */
export const highlightIn = (
  count: number,
  stepped: number,
): number | undefined =>
  count === 0 ? undefined : Math.min(stepped, count - 1);

/**
 * Where an arrow key lands, clamped rather than wrapped.
 *
 * Lists can be hundreds of rows long; wrapping would lose the user's place.
 */
export const steppedTo = (from: number, by: number, count: number): number =>
  Math.max(Math.min(from + by, count - 1), 0);

/**
 * Scroll the newly highlighted row into view.
 *
 * `nearest` avoids moving the whole list when the row is one line away. React
 * passes `null` for a detached row, which needs no scroll.
 */
export const keepInView = (row: HTMLElement | null) => {
  if (row !== null) {
    row.scrollIntoView({ block: "nearest" });
  }
};
