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

  describe("interactions", () => {
    it("flips when its label is clicked", async () => {
      const checked = await new Promise((resolve) => {
        render(
          <Switch
            defaultChecked
            label="Keyboard"
            onCheckedChange={(next) => {
              resolve(next);
            }}
          />,
        );
        userEvent
          .click(screen.getByText("Keyboard"))
          .catch((error: unknown) => {
            throw error;
          });
      });

      expect(checked).toBe(false);
    });
  });
});
