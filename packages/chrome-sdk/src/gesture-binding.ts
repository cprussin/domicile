// Touchpad gestures as bindings, in sway's `bindgesture` grammar:
// `<kind>[:<fingers>][:<direction>[+<direction>...]]`, such as `swipe:3:left`
// or `pinch:4:inward`. They sit beside chords in a shell's keybindings and
// share its modes. See docs/architecture/GESTURES.md.

import type { Gesture, GestureKind } from "./desktop/gestures";

export type GestureDirection =
  | "clockwise"
  | "counterclockwise"
  | "down"
  | "inward"
  | "left"
  | "outward"
  | "right"
  | "up";

/** A parsed gesture binding. */
export type GestureBinding = {
  readonly kind: GestureKind;
  /** `undefined` for any count of three or more. */
  readonly fingers: number | undefined;
  /** Every direction the gesture must have gone; none for any. */
  readonly directions: ReadonlySet<GestureDirection>;
};

/** A gesture that ended without being canceled, and where it went. */
export type FinishedGesture = {
  readonly kind: GestureKind;
  readonly fingers: number;
  readonly directions: ReadonlySet<GestureDirection>;
};

/** The fewest fingers the engine hands the shell; two are the page's. */
const FEWEST_FINGERS = 3;

/** Directions in a spelled binding's order, by the kinds that have them. */
const DIRECTIONS: Readonly<Record<GestureKind, readonly GestureDirection[]>> = {
  hold: [],
  pinch: ["inward", "outward", "clockwise", "counterclockwise"],
  swipe: ["up", "down", "left", "right"],
};

const KINDS: ReadonlyMap<string, GestureKind> = new Map([
  ["hold", "hold"],
  ["pinch", "pinch"],
  ["swipe", "swipe"],
]);

/** Whether `written` names a gesture rather than a chord. */
export const isGesture = (written: string): boolean =>
  /^(?:hold|pinch|swipe)(?::|$)/.test(written);

/** `written` parsed. Throws on a binding written wrong. */
export const parseGesture = (written: string): GestureBinding => {
  const fail = (why: string): never => {
    throw new Error(`domicile: gesture ${JSON.stringify(written)} ${why}`);
  };
  const [name = "", ...rest] = written.split(":");
  const kind = KINDS.get(name) ?? fail("is not a swipe, pinch or hold");
  const [count, directions] = /^\d+$/.test(rest[0] ?? "")
    ? [Number(rest[0]), rest.slice(1)]
    : [undefined, rest];
  if (count !== undefined && count < FEWEST_FINGERS) {
    fail(
      `has ${count} fingers; two are the window's, so the shell's gestures take ${FEWEST_FINGERS} or more`,
    );
  }
  if (directions.length > 1) {
    fail("has more than one direction part; join directions with `+`");
  }
  const allowed = DIRECTIONS[kind];
  const went = (directions[0]?.split("+") ?? []).map(
    (direction) =>
      allowed.find((known) => known === direction) ??
      fail(
        allowed.length === 0
          ? `has a direction, which a ${kind} does not`
          : `goes ${JSON.stringify(direction)}; a ${kind} goes ${allowed.join(", ")}`,
      ),
  );
  if (new Set(went).size !== went.length) {
    fail("names a direction twice");
  }
  return { directions: new Set(went), fingers: count, kind };
};

/** `written` in its one spelling, directions in a fixed order. */
export const spelledGesture = (written: string): string => {
  const { kind, fingers, directions } = parseGesture(written);
  const went = DIRECTIONS[kind].filter((direction) =>
    directions.has(direction),
  );
  return [kind, fingers, went.length === 0 ? undefined : went.join("+")]
    .filter((part) => part !== undefined)
    .join(":");
};

/** What `binding` asks the engine for: its kind, and its count if it has one. */
export const grabOf = ({ kind, fingers }: GestureBinding): string =>
  fingers === undefined ? kind : `${kind}:${fingers}`;

/**
 * Follows one gesture at a time through its phases; `feed` returns it once
 * it ends without being canceled.
 *
 * A swipe went its larger axis's way, and also its smaller one's when that
 * moved at least half as far, so `swipe:3:up+left` is a diagonal. A pinch
 * went inward or outward by its last scale, and clockwise or
 * counterclockwise by its summed rotation.
 */
export const gestureTracker = (): {
  feed: (gesture: Gesture) => FinishedGesture | undefined;
} => {
  let sum = { dx: 0, dy: 0, rotation: 0, scale: 1 };
  return {
    feed: (gesture) => {
      if (gesture.phase === "begin") {
        sum = { dx: 0, dy: 0, rotation: 0, scale: 1 };
      } else if (gesture.phase === "update") {
        sum = {
          dx: sum.dx + gesture.dx,
          dy: sum.dy + gesture.dy,
          rotation: sum.rotation + gesture.rotation,
          scale: gesture.scale,
        };
      } else if (!gesture.canceled) {
        return {
          directions: directionsOf(gesture.kind, sum),
          fingers: gesture.fingers,
          kind: gesture.kind,
        };
      }
      return undefined;
    },
  };
};

const directionsOf = (
  kind: GestureKind,
  {
    dx,
    dy,
    rotation,
    scale,
  }: Record<"dx" | "dy" | "rotation" | "scale", number>,
): ReadonlySet<GestureDirection> => {
  switch (kind) {
    case "hold": {
      return new Set();
    }
    case "pinch": {
      const went: readonly (readonly [boolean, GestureDirection])[] = [
        [scale < 1, "inward"],
        [scale > 1, "outward"],
        [rotation > 0, "clockwise"],
        [rotation < 0, "counterclockwise"],
      ];
      return new Set(went.filter(([did]) => did).map(([, way]) => way));
    }
    case "swipe": {
      const horizontal: GestureDirection = dx < 0 ? "left" : "right";
      const vertical: GestureDirection = dy < 0 ? "up" : "down";
      const [major, minor, majorWay, minorWay] =
        Math.abs(dx) >= Math.abs(dy)
          ? [Math.abs(dx), Math.abs(dy), horizontal, vertical]
          : [Math.abs(dy), Math.abs(dx), vertical, horizontal];
      const went: readonly (readonly [boolean, GestureDirection])[] = [
        [major > 0, majorWay],
        [minor > 0 && minor * 2 >= major, minorWay],
      ];
      return new Set(went.filter(([did]) => did).map(([, way]) => way));
    }
  }
};

/**
 * The binding of `bindings` that best fits `finished`, of those whose kind,
 * count and every direction it matches: a count over none, then more
 * directions over fewer.
 */
export const bestGesture = <T>(
  bindings: Iterable<readonly [GestureBinding, T]>,
  finished: FinishedGesture,
): T | undefined =>
  [...bindings]
    .filter(
      ([{ kind, fingers, directions }]) =>
        kind === finished.kind &&
        (fingers === undefined || fingers === finished.fingers) &&
        [...directions].every((direction) =>
          finished.directions.has(direction),
        ),
    )
    .sort(
      ([a], [b]) =>
        Number(b.fingers !== undefined) - Number(a.fingers !== undefined) ||
        b.directions.size - a.directions.size,
    )
    .at(0)?.[1];
