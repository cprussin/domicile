// Keyboard movement of a highlight through a list, while focus stays in the
// input above it. Used by the launcher and the file picker.

/**
 * How far a key press moves the highlight, or `undefined` if it does not move
 * it. Handles the arrows and Emacs-style `ctrl+n` / `ctrl+p`.
 */
export const stepOf = ({
  ctrlKey,
  key,
}: {
  ctrlKey: boolean;
  key: string;
}): number | undefined => {
  switch (key) {
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
