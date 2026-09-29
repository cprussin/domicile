// How the keyboard walks a highlight down a list of rows it never leaves the
// box above — the launcher's, and a browser window's file picker.

/**
 * How far a key press walks the highlight, or `undefined` for one that does
 * not walk it: the arrows, and the `ctrl+n` / `ctrl+p` of Emacs and readline.
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
 * Which of `count` rows is highlighted: the one walked to, kept inside the
 * list, or none when there is no list. A fresh walk starts on the first row,
 * so Enter takes the top row without anybody pressing an arrow key.
 */
export const highlightIn = (
  count: number,
  stepped: number,
): number | undefined =>
  count === 0 ? undefined : Math.min(stepped, count - 1);

/**
 * Where an arrow key lands, clamped rather than wrapped.
 *
 * Wrapping is what a menu does, and a menu is short. A home directory is not:
 * an Up press that jumped to the bottom of two hundred rows would lose the
 * user's place rather than move it.
 */
export const steppedTo = (from: number, by: number, count: number): number =>
  Math.max(Math.min(from + by, count - 1), 0);

/**
 * Scroll the row the highlight just arrived at into the list.
 *
 * A home is longer than the list is tall, so without this the keyboard walks
 * off the bottom of what is drawn and the user is moving something they
 * cannot see. `nearest` because the row is usually one line away: scrolling
 * it to the middle would move the whole list under a press that moved one
 * row. React hands a detached row `null`, which is the walk leaving rather
 * than arriving and so has nothing to scroll.
 */
export const keepInView = (row: HTMLElement | null) => {
  if (row !== null) {
    row.scrollIntoView({ block: "nearest" });
  }
};
