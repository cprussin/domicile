import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch } from "./Switch";

describe(Switch, () => {
  describe("rendering", () => {
    it("is a switch named by its label, in its state", () => {
      render(<Switch defaultChecked label="Keyboard" />);

      expect(screen.getByRole("switch", { name: "Keyboard" })).toBeChecked();
    });
  });

  describe("with its label hidden", () => {
    it("is still named by it, beside a title that says the same", () => {
      render(<Switch checked hideLabel label="Bluetooth" />);
      expect(screen.getByRole("switch", { name: "Bluetooth" })).toBeChecked();
      expect(screen.queryByText("Bluetooth")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("flips when its label is clicked", async () => {
      const checked = new Promise((resolve) => {
        render(
          <Switch
            defaultChecked
            label="Keyboard"
            onCheckedChange={(next) => {
              resolve(next);
            }}
          />,
        );
      });
      await userEvent.click(screen.getByText("Keyboard"));

      expect(await checked).toBe(false);
    });
  });
});
