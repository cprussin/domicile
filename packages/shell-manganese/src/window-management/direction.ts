// The directions for `focus`, `move` and `resize` commands.
//
// Shared by the keybindings, the layout tree and floating windows.

/** Which way a container lays its children out. */
export enum Axis {
  Horizontal,
  Vertical,
}

export enum Direction {
  Left,
  Down,
  Up,
  Right,
}

/** The axis a direction runs along. */
export const axisOf = (direction: Direction): Axis => {
  switch (direction) {
    case Direction.Left:
    case Direction.Right: {
      return Axis.Horizontal;
    }
    case Direction.Down:
    case Direction.Up: {
      return Axis.Vertical;
    }
  }
};

/**
 * Whether a direction points towards the end of a container's children, which
 * is the bottom-right of the screen.
 */
export const isForward = (direction: Direction): boolean => {
  switch (direction) {
    case Direction.Down:
    case Direction.Right: {
      return true;
    }
    case Direction.Left:
    case Direction.Up: {
      return false;
    }
  }
};
