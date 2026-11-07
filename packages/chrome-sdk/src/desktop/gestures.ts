// Touchpad gestures of three fingers or more, which the shell claims from the
// window under the pointer. Two fingers stay the page's. See
// docs/architecture/GESTURES.md.

import type { DomicileGestureEvent, DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type GestureKind = "hold" | "pinch" | "swipe";

export type GesturePhase = "begin" | "end" | "update";

/** A phase of a grabbed gesture. */
export type Gesture = {
  kind: GestureKind;
  phase: GesturePhase;
  fingers: number;
  /** This update's motion, in the touchpad's accelerated pointer units. */
  dx: number;
  dy: number;
  /** A pinch's scale relative to its begin. */
  scale: number;
  /** This update's rotation, in degrees clockwise. */
  rotation: number;
  /** On an end: the gesture was abandoned rather than finished. */
  canceled: boolean;
};

export type GesturesListeners = {
  /** A phase of a grabbed gesture, wherever the pointer is. */
  gesture: (gesture: Gesture) => void;
};

export type Gestures = {
  /**
   * Route `gesture`, written `swipe`, `pinch` or `hold` with an optional
   * finger count such as `swipe:3`, to the page rather than to the window
   * under the pointer. A count left out is any of three or more. Throws a
   * SyntaxError for a gesture written wrong or of fewer than three fingers.
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
  ["hold", "hold"],
  ["pinch", "pinch"],
  ["swipe", "swipe"],
]);

const PHASES: ReadonlyMap<string, GesturePhase> = new Map([
  ["begin", "begin"],
  ["end", "end"],
  ["update", "update"],
]);

/** The event as a {@link Gesture}, or `undefined` for a kind or phase this SDK predates. */
const gestureOf = (event: DomicileGestureEvent): Gesture | undefined => {
  const kind = KINDS.get(event.kind);
  const phase = PHASES.get(event.phase);
  return kind === undefined || phase === undefined
    ? undefined
    : {
        canceled: event.canceled,
        dx: event.dx,
        dy: event.dy,
        fingers: event.fingers,
        kind,
        phase,
        rotation: event.rotation,
        scale: event.scale,
      };
};
