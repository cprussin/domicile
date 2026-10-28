import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedSlidersIcon } from "./AnimatedSlidersIcon";

describe(AnimatedSlidersIcon, () => {
  it("slides its knobs opposite ways", () => {
    const { container } = render(<AnimatedSlidersIcon size={14} />);
    expect(
      [
        ...container.querySelectorAll<SVGGElement>("svg > [data-part=knob]"),
      ].map((knob) => knob.style.getPropertyValue("--part-x")),
    ).toEqual(["1", "-1"]);
  });

  it("hides each track under its knob, with a mask that moves as the knob does", () => {
    const { container } = render(<AnimatedSlidersIcon size={14} />);
    const masks = [...container.querySelectorAll("mask")];
    expect(masks).toHaveLength(2);
    for (const mask of masks) {
      expect(mask.querySelector("[data-part=knob-disk]")).not.toBeNull();
      expect(
        container.querySelector(`[mask="url(#${mask.id})"] [data-part=track]`),
      ).not.toBeNull();
    }
  });
});
