// Touchpad gestures of three fingers or more, which the shell claims from the
// window under the pointer, and touchscreen fingers in from a display's edge.
// Two touchpad fingers stay the page's. See docs/architecture/GESTURES.md.

import type { DomicileGestureEvent, DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type GestureKind = "edge" | "hold" | "pinch" | "swipe";

/** The side of the display an edge swipe came in from. */
export type GestureEdge = "bottom" | "left" | "right" | "top";

export type GesturePhase = "begin" | "end" | "update";

/** A phase of a grabbed gesture. */
export type Gesture = {
  kind: GestureKind;
  phase: GesturePhase;
  fingers: number;
  /**
   * This update's motion, in the touchpad's accelerated pointer units, or an
   * edge swipe's in the display's pixels.
   */
  dx: number;
  dy: number;
  /** A pinch's scale relative to its begin. */
  scale: number;
  /** This update's rotation, in degrees clockwise. */
  rotation: number;
  /** On an end: the gesture was abandoned rather than finished. */
  canceled: boolean;
  /** An edge swipe's side; `undefined` for every other kind. */
  edge: GestureEdge | undefined;
};

export type GesturesListeners = {
  /** A phase of a grabbed gesture, wherever the pointer is. */
  gesture: (gesture: Gesture) => void;
};

export type Gestures = {
  /**
   * Route `gesture`, written `swipe`, `pinch` or `hold` with an optional
   * finger count such as `swipe:3`, to the page rather than to the window
   * under the pointer. A count left out is any of three or more. Or a
   * touchscreen finger in from a display's edge: `edge:left`, `right`, `top`
   * or `bottom`, or `edge` for any. Throws a SyntaxError for a gesture
   * written wrong or of fewer than three fingers.
   */
  grab: (gesture: string) => void;
  /** Answer one {@link Gestures.grab}; the last gives the gesture back. */
  ungrab: (gesture: string) => void;
  on: On<GesturesListeners>;
};

export type GesturesHost = Pick<
  DomicileHost,
  "addEventListener" | "grabGesture" | "removeEventListener" | "ungrabGesture"
>;

export const gestures = (host: GesturesHost): Gestures => ({
  grab: (gesture) => {
    host.grabGesture(gesture);
  },
  on: on<GesturesListeners>({
    gesture: (listener) =>
      hostEvent(host, "gesture", (event) => {
        const gesture = gestureOf(event);
        if (gesture !== undefined) {
          listener(gesture);
        }
      }),
  }),
  ungrab: (gesture) => {
    host.ungrabGesture(gesture);
  },
});

const KINDS: ReadonlyMap<string, GestureKind> = new Map([
  ["edge", "edge"],
  ["hold", "hold"],
  ["pinch", "pinch"],
  ["swipe", "swipe"],
]);

const EDGES: ReadonlyMap<string, GestureEdge> = new Map([
  ["bottom", "bottom"],
  ["left", "left"],
  ["right", "right"],
  ["top", "top"],
]);

const PHASES: ReadonlyMap<string, GesturePhase> = new Map([
  ["begin", "begin"],
  ["end", "end"],
  ["update", "update"],
]);

/** The event as a {@link Gesture}, or `undefined` for a kind, phase or edge this SDK predates. */
const gestureOf = (event: DomicileGestureEvent): Gesture | undefined => {
  const kind = KINDS.get(event.kind);
  const phase = PHASES.get(event.phase);
  const edge = EDGES.get(event.edge);
  return kind === undefined ||
    phase === undefined ||
    (kind === "edge" && edge === undefined)
    ? undefined
    : {
        canceled: event.canceled,
        dx: event.dx,
        dy: event.dy,
        edge,
        fingers: event.fingers,
        kind,
        phase,
        rotation: event.rotation,
        scale: event.scale,
      };
};
