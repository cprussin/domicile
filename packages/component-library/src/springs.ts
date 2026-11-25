/**
 * Spring motion as CSS easings: a `linear()` curve sampled from a damped
 * spring, with the time it takes to settle as its duration. See
 * docs/architecture/MOTION.md.
 */

/** A damped spring moving from 0 to 1 from rest. */
export type Spring = {
  readonly damping: number;
  readonly mass: number;
  readonly stiffness: number;
};

/** The springs behind the `springs.*` easing and duration tokens. */
export const SPRINGS = {
  // Overshoots by about a sixth, for a landing that should be seen.
  bouncy: { damping: 18, mass: 1, stiffness: 320 },
  // Critically damped, for things that arrive.
  smooth: { damping: 36, mass: 1, stiffness: 324 },
  // Critically damped and quick, for things that leave or answer a click.
  snappy: { damping: 52, mass: 1, stiffness: 676 },
} as const satisfies Record<string, Spring>;

/** How close to its target a spring has to stay to count as settled. */
const SETTLE_TOLERANCE = 0.001;
/** Simulation step for finding the settle time, in seconds. */
const SETTLE_STEP_S = 0.0001;
/** A spring that has not settled by then is a mistake in its parameters. */
const MAX_SETTLE_S = 5;
/** `linear()` stops. Enough that the curve's corners don't show. */
const STOPS = 64;

/** The CSS easing and duration that play `spring` once. */
export const springEasing = (
  spring: Spring,
): { readonly duration: string; readonly easing: string } => {
  const { settleS, stops } = sampled(spring);
  return {
    duration: `${Math.round(settleS * 1000)}ms`,
    easing: `linear(${stops.join(", ")})`,
  };
};

/**
 * How far into a motion on `spring`, in milliseconds, to start it so it begins
 * where an opposite motion on the same spring, cut short `intoMs` in, has got
 * to. Both run forwards from rest, so a motion turned back as it lands starts
 * at once rather than in the spring's slow tail.
 *
 * Reads the `linear()` stops CSS plays, so the two meet exactly.
 */
export const turnedBack = (spring: Spring, intoMs: number): number => {
  const { settleS, stops } = sampled(spring);
  const lengthMs = Math.round(settleS * 1000);
  if (
    stops.some((stop, index) => index > 0 && stop < stopAt(stops, index - 1))
  ) {
    throw new Error("a spring that overshoots passes a point twice");
  } else {
    const at = (Math.min(intoMs, lengthMs) / lengthMs) * STOPS;
    const before = Math.min(Math.floor(at), STOPS - 1);
    const left = 1 - lerp(stops, before, at - before);
    const after = stops.findIndex(
      (_, index) => index < STOPS && stopAt(stops, index + 1) >= left,
    );
    const from = stopAt(stops, after);
    const fraction = (left - from) / (stopAt(stops, after + 1) - from);
    return ((after + fraction) / STOPS) * lengthMs;
  }
};

/** The spring's settle time and its `linear()` stops over that time. */
const sampled = (
  spring: Spring,
): { readonly settleS: number; readonly stops: readonly number[] } => {
  const position = springPosition(spring);
  const settleS = settleTime(position);
  return {
    settleS,
    stops: Array.from({ length: STOPS + 1 }, (_, index) =>
      index === STOPS ? 1 : round(position((settleS * index) / STOPS)),
    ),
  };
};

/** The value `fraction` of the way from stop `index` to the next. */
const lerp = (
  stops: readonly number[],
  index: number,
  fraction: number,
): number => {
  const from = stopAt(stops, index);
  return from + (stopAt(stops, index + 1) - from) * fraction;
};

/** Stop `index`, which every caller keeps in range. */
const stopAt = (stops: readonly number[], index: number): number => {
  const stop = stops[index];
  if (stop === undefined) {
    throw new Error(`no linear() stop ${index}`);
  } else {
    return stop;
  }
};

/** The spring's position at a time in seconds, solved in closed form. */
const springPosition = ({
  damping,
  mass,
  stiffness,
}: Spring): ((timeS: number) => number) => {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    return (t) =>
      1 -
      Math.exp(-zeta * omega * t) *
        (Math.cos(omegaD * t) +
          ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    return (t) => 1 - (1 + omega * t) * Math.exp(-omega * t);
  } else {
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const fast = -zeta * omega - root;
    const slow = -zeta * omega + root;
    return (t) =>
      1 -
      (fast * Math.exp(slow * t) - slow * Math.exp(fast * t)) / (fast - slow);
  }
};

/** The time after which the spring stays within `SETTLE_TOLERANCE`. */
const settleTime = (position: (timeS: number) => number): number => {
  const steps = Math.round(MAX_SETTLE_S / SETTLE_STEP_S);
  const lastAway = Array.from({ length: steps }, (_, index) => index).findLast(
    (index) => Math.abs(1 - position(index * SETTLE_STEP_S)) > SETTLE_TOLERANCE,
  );
  if (lastAway === undefined || lastAway === steps - 1) {
    throw new Error(`a spring did not settle within ${MAX_SETTLE_S}s`);
  } else {
    return (lastAway + 1) * SETTLE_STEP_S;
  }
};

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
