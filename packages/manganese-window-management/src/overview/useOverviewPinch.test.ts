import { describe, expect, it } from "bun:test";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { act, renderHook } from "@testing-library/react";

import { useOverviewPinch } from "./useOverviewPinch";

type Gestures = Pick<Domicile["gestures"], "on">;
type Listener = Parameters<Gestures["on"]>[1];
type Gesture = Parameters<Listener>[0];

/** Gestures the test plays to the hook. */
const fakeGestures = () => {
  const listeners = new Set<Listener>();
  const gestures: Gestures = {
    on: (_type, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const play = (gesture: Partial<Gesture>) => {
    act(() => {
      for (const listener of listeners) {
        listener({ ...PINCH, ...gesture });
      }
    });
  };
  return { gestures, play };
};

const PINCH: Gesture = {
  canceled: false,
  dx: 0,
  dy: 0,
  edge: undefined,
  fingers: 4,
  kind: "pinch",
  phase: "update",
  rotation: 0,
  scale: 1,
};

const pinched = (open: boolean) => {
  const { gestures, play } = fakeGestures();
  const { rerender, result } = renderHook(
    (next: boolean) => useOverviewPinch(gestures, next),
    { initialProps: open },
  );
  return { play, rerender, result };
};

describe("useOverviewPinch", () => {
  it("opens the overview as four fingers pinch in, fully at half their spread", () => {
    const { play, result } = pinched(false);
    expect(result.current).toBeUndefined();

    play({ phase: "begin" });
    expect(result.current).toBe(0);
    play({ scale: Math.SQRT1_2 });
    expect(result.current).toBeCloseTo(0.5);
    play({ scale: 0.4 });
    expect(result.current).toBe(1);
  });

  it("turns back as the fingers spread again, mid-gesture", () => {
    const { play, result } = pinched(false);

    play({ phase: "begin" });
    play({ scale: 0.5 });
    play({ scale: 1.2 });

    expect(result.current).toBe(0);
  });

  it("closes an open overview as the fingers spread, fully at twice their spread", () => {
    const { play, result } = pinched(true);

    play({ phase: "begin" });
    expect(result.current).toBe(1);
    play({ scale: Math.SQRT2 });
    expect(result.current).toBeCloseTo(0.5);
    play({ scale: 2 });
    expect(result.current).toBe(0);
  });

  it("lets go once the fingers lift, for the overview to settle where the pinch went", () => {
    const { play, result } = pinched(false);

    play({ phase: "begin" });
    play({ scale: 0.8 });
    play({ phase: "end" });

    expect(result.current).toBeUndefined();
  });

  it("follows only four-finger pinches", () => {
    const { play, result } = pinched(false);

    play({ fingers: 3, phase: "begin" });
    play({ kind: "swipe", phase: "begin" });

    expect(result.current).toBeUndefined();
  });
});
