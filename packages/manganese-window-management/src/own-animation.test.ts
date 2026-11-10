import { describe, expect, it } from "bun:test";
import type { AnimationEvent } from "react";

import { endsOwnAnimation } from "./own-animation";

/** The end of `name` on `target`, heard on `element`. */
const ended = (
  element: HTMLElement,
  name: string,
  target: Element = element,
): AnimationEvent<Element> =>
  ({
    animationName: name,
    currentTarget: element,
    target,
  }) as unknown as AnimationEvent<Element>;

const playing = (names: string): HTMLElement => {
  const element = document.createElement("div");
  element.style.animationName = names;
  document.body.append(element);
  return element;
};

describe("endsOwnAnimation", () => {
  it("is the end of an animation the element plays now", () => {
    const element = playing("windowRevealing, windowHeldTiled");

    expect(endsOwnAnimation(ended(element, "windowHeldTiled"))).toBe(true);
  });

  // A tab switched again before its fade is done can still hear that fade
  // end, which would cut the new motion short.
  it("is not the end of an animation a new motion replaced", () => {
    const element = playing("windowConcealing");

    expect(endsOwnAnimation(ended(element, "windowRevealing"))).toBe(false);
  });

  it("is not a descendant's animation", () => {
    const element = playing("windowConcealing");
    const child = document.createElement("span");
    element.append(child);

    expect(endsOwnAnimation(ended(element, "windowConcealing", child))).toBe(
      false,
    );
  });

  // A test DOM leaves the names out.
  it("takes any end on an element with no names", () => {
    const element = playing("");

    expect(endsOwnAnimation(ended(element, "windowClosing"))).toBe(true);
  });
});
