import { describe, expect, it } from "bun:test";
import type { Gesture } from "./desktop/gestures";
import type { FinishedGesture } from "./gesture-binding";
import {
  bestGesture,
  gestureTracker,
  grabOf,
  isGesture,
  parseGesture,
  spelledGesture,
} from "./gesture-binding";

const phase = (
  kind: Gesture["kind"],
  rest: Partial<Gesture> & Pick<Gesture, "phase">,
): Gesture => ({
  canceled: false,
  dx: 0,
  dy: 0,
  fingers: 3,
  kind,
  rotation: 0,
  scale: 1,
  ...rest,
});

/** Where `updates` of a three-finger `kind` went, once it ends. */
const finished = (
  kind: Gesture["kind"],
  updates: readonly Partial<Gesture>[],
  end: Partial<Gesture> = {},
): FinishedGesture | undefined => {
  const tracker = gestureTracker();
  tracker.feed(phase(kind, { phase: "begin" }));
  for (const update of updates) {
    tracker.feed(phase(kind, { phase: "update", ...update }));
  }
  return tracker.feed(phase(kind, { phase: "end", ...end }));
};

describe("isGesture", () => {
  it("tells a gesture from a chord", () => {
    expect(isGesture("swipe:3:left")).toBe(true);
    expect(isGesture("hold")).toBe(true);
    expect(isGesture("Meta+h")).toBe(false);
    expect(isGesture("holdup")).toBe(false);
  });
});

describe("spelledGesture", () => {
  it("spells directions in one order", () => {
    expect(spelledGesture("swipe:3:left+up")).toBe("swipe:3:up+left");
    expect(spelledGesture("pinch:counterclockwise+inward")).toBe(
      "pinch:inward+counterclockwise",
    );
    expect(spelledGesture("hold:4")).toBe("hold:4");
  });

  it.each([
    ["swipe:2:left", "fingers"],
    ["swipe:3:inward", "goes"],
    ["hold:3:up", "direction"],
    ["swipe:3:left:up", "`+`"],
    ["swipe:3:left+left", "twice"],
    ["rub:3", "swipe, pinch or hold"],
  ])("rejects %s", (written, why) => {
    expect(() => spelledGesture(written)).toThrow(why);
  });
});

describe("grabOf", () => {
  it("grabs the kind and count, not the direction", () => {
    expect(grabOf(parseGesture("swipe:3:left"))).toBe("swipe:3");
    expect(grabOf(parseGesture("pinch:inward"))).toBe("pinch");
  });
});

describe("gestureTracker", () => {
  it("sums a swipe's motion into its larger axis", () => {
    expect(
      finished("swipe", [
        { dx: -10, dy: 2 },
        { dx: -20, dy: -1 },
      ]),
    ).toStrictEqual({
      directions: new Set(["left"]),
      fingers: 3,
      kind: "swipe",
    });
  });

  it("calls a swipe diagonal when its smaller axis moved half as far", () => {
    expect(finished("swipe", [{ dx: 10, dy: -6 }])?.directions).toStrictEqual(
      new Set(["right", "up"]),
    );
  });

  it("reads a pinch by its last scale and summed rotation", () => {
    expect(
      finished("pinch", [
        { rotation: -2, scale: 0.9 },
        { rotation: -1, scale: 0.6 },
      ])?.directions,
    ).toStrictEqual(new Set(["inward", "counterclockwise"]));
  });

  it("finishes nothing for a canceled gesture", () => {
    expect(
      finished("swipe", [{ dx: -30 }], { canceled: true }),
    ).toBeUndefined();
  });

  it("starts each gesture afresh", () => {
    const tracker = gestureTracker();
    tracker.feed(phase("swipe", { phase: "begin" }));
    tracker.feed(phase("swipe", { dx: 50, phase: "update" }));
    tracker.feed(phase("swipe", { canceled: true, phase: "end" }));
    tracker.feed(phase("swipe", { phase: "begin" }));
    tracker.feed(phase("swipe", { dx: -5, phase: "update" }));

    expect(
      tracker.feed(phase("swipe", { phase: "end" }))?.directions,
    ).toStrictEqual(new Set(["left"]));
  });
});

describe("bestGesture", () => {
  const bindings = [
    "swipe:left",
    "swipe:3",
    "swipe:3:left",
    "swipe:3:up+left",
    "pinch:inward",
  ].map((written) => [parseGesture(written), written] as const);

  it("prefers a count, then more directions", () => {
    expect(
      bestGesture(bindings, {
        directions: new Set(["left"]),
        fingers: 3,
        kind: "swipe",
      }),
    ).toBe("swipe:3:left");
    expect(
      bestGesture(bindings, {
        directions: new Set(["up", "left"]),
        fingers: 3,
        kind: "swipe",
      }),
    ).toBe("swipe:3:up+left");
    expect(
      bestGesture(bindings, {
        directions: new Set(["left"]),
        fingers: 4,
        kind: "swipe",
      }),
    ).toBe("swipe:left");
  });

  it("matches nothing that went another way", () => {
    expect(
      bestGesture(bindings, {
        directions: new Set(["outward"]),
        fingers: 3,
        kind: "pinch",
      }),
    ).toBeUndefined();
  });
});
