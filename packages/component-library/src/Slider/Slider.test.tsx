import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Slider } from "./Slider";

describe(Slider, () => {
  describe("rendering", () => {
    it("is a slider named by its label, at its value", () => {
      render(<Slider label="Brightness" max={100} min={0} value={42} />);

      const slider = screen.getByRole("slider", { name: "Brightness" });
      expect(slider).toHaveAttribute("aria-valuenow", "42");
    });
  });

  describe("level", () => {
    it("draws no meter unless given a level", () => {
      render(<Slider label="Volume" max={100} min={0} value={42} />);

      expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    });

    it("meters a level beside the value, named for the slider", () => {
      render(
        <Slider label="Volume" level={0.25} max={100} min={0} value={42} />,
      );

      expect(
        screen.getByRole("meter", { name: "Volume level" }),
      ).toHaveAttribute("aria-valuenow", "25");
    });
  });

  describe("interactions", () => {
    it("steps with the arrow keys", async () => {
      const value = new Promise((resolve) => {
        render(
          <Slider
            label="Brightness"
            max={100}
            min={0}
            onValueChange={resolve}
            step={5}
            value={40}
          />,
        );
      });
      act(() => {
        screen.getByRole("slider", { name: "Brightness" }).focus();
      });
      await userEvent.keyboard("{ArrowRight}");

      expect(await value).toBe(45);
    });
  });
});
