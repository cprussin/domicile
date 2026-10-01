import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
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

  describe("interactions", () => {
    it("steps with the arrow keys", async () => {
      const value = await new Promise((resolve) => {
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
        screen.getByRole("slider", { name: "Brightness" }).focus();
        userEvent.keyboard("{ArrowRight}").catch((error: unknown) => {
          throw error;
        });
      });

      expect(value).toBe(45);
    });
  });
});
