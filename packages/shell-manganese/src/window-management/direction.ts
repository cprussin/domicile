// The four ways a desktop keyed with `focus`, `move` and `resize` points.
//
// Its own module because three different things read one of these: the
// bindings that produce them, the tree that walks them, and a floating
// window's own box.

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

/** Which axis moving this way runs along. */
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
 * Whether this way is forward along its axis — towards the end of a
 * container's children, and towards the bottom-right of the screen.
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
