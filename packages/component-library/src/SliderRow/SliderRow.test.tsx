import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { SliderRow } from "./SliderRow";

describe(SliderRow, () => {
  describe("rendering", () => {
    it("draws its lead, slider, figure and end in a row", () => {
      render(
        <SliderRow
          end={<button type="button">Sound details</button>}
          figure="70%"
          lead={<button type="button">Mute</button>}
        >
          <input aria-label="Volume" type="range" />
        </SliderRow>,
      );
      expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
      expect(
        screen.getByRole("slider", { name: "Volume" }),
      ).toBeInTheDocument();
      expect(screen.getByText("70%")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Sound details" }),
      ).toBeInTheDocument();
    });
  });
});
