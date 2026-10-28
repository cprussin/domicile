import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IconButton } from "./IconButton";

describe(IconButton, () => {
  describe("rendering", () => {
    it("is named by its label, not its icon", () => {
      render(
        <IconButton label="Scan">
          <svg data-testid="icon" />
        </IconButton>,
      );
      expect(screen.getByRole("button", { name: "Scan" })).toContainElement(
        screen.getByTestId("icon"),
      );
    });
  });

  describe("interactions", () => {
    it("is pressed", async () => {
      const pressed = new Promise((resolve) => {
        render(
          <IconButton
            label="Scan"
            onClick={() => {
              resolve(true);
            }}
          >
            <svg />
          </IconButton>,
        );
      });
      await userEvent.click(screen.getByRole("button", { name: "Scan" }));
      expect(await pressed).toBe(true);
    });

    it("ignores presses while disabled", async () => {
      const presses: string[] = [];
      render(
        <IconButton
          disabled
          label="Scan"
          onClick={() => {
            presses.push("scan");
          }}
        >
          <svg />
        </IconButton>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Scan" }));
      expect(presses).toEqual([]);
    });
  });
});
