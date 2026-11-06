import { describe, expect, it, mock } from "bun:test";
import { fireEvent } from "@testing-library/react";

import { capturingElement } from "./captured-element";
import { followPress } from "./follow-press";

/** A press on a fresh element that captured the pointer, followed. */
const following = () => {
  const element = capturingElement();
  element.setPointerCapture(1);
  const calls = { onEnd: mock(() => undefined), onMove: mock(() => undefined) };
  const stop = followPress({ element, pointerId: 1, ...calls });
  return { calls, element, stop };
};

const moveHeld = (): void => {
  fireEvent.pointerMove(window, { buttons: 1, pointerId: 1 });
};

describe("followPress", () => {
  it("passes on moves while a button is held", () => {
    const { calls } = following();
    moveHeld();
    moveHeld();
    expect(calls.onMove).toHaveBeenCalledTimes(2);
    expect(calls.onEnd).not.toHaveBeenCalled();
  });

  describe("ends, once, and lets go of the pointer", () => {
    // `fireEvent` on `window` and on the element.
    const endings: [string, (element: HTMLElement) => void][] = [
      ["at a release", () => fireEvent.pointerUp(window, { pointerId: 1 })],
      ["at a cancel", () => fireEvent.pointerCancel(window, { pointerId: 1 })],
      [
        "at a move with no button held",
        () => fireEvent.pointerMove(window, { buttons: 0, pointerId: 1 }),
      ],
      [
        "when the element loses the pointer",
        (element) => fireEvent(element, new Event("lostpointercapture")),
      ],
    ];
    for (const [when, end] of endings) {
      it(when, () => {
        const { calls, element } = following();
        end(element);
        fireEvent.pointerUp(window, { pointerId: 1 });
        moveHeld();
        expect(calls.onEnd).toHaveBeenCalledTimes(1);
        expect(calls.onMove).not.toHaveBeenCalled();
        expect(element.hasPointerCapture(1)).toBe(false);
      });
    }
  });

  it("stops without ending", () => {
    const { calls, element, stop } = following();
    stop();
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent(element, new Event("lostpointercapture"));
    moveHeld();
    expect(calls.onEnd).not.toHaveBeenCalled();
    expect(calls.onMove).not.toHaveBeenCalled();
  });
});
