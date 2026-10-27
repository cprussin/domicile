import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QuickTile } from "./QuickTile";

describe(QuickTile, () => {
  describe("rendering", () => {
    it("names the toggle with its label and shows its detail", () => {
      render(
        <QuickTile
          detail="Home"
          icon={<span />}
          label="Wi-Fi"
          onPressedChange={() => undefined}
          pressed
        />,
      );
      expect(screen.getByRole("button", { name: "Wi-Fi" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByText("Home")).toBeInTheDocument();
    });

    it("has no details button without one to open", () => {
      render(
        <QuickTile
          icon={<span />}
          label="Dark mode"
          onPressedChange={() => undefined}
          pressed={false}
        />,
      );
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
  });

  describe("interactions", () => {
    it("asks for the other state when pressed", async () => {
      const asked = await new Promise((resolve) => {
        render(
          <QuickTile
            icon={<span />}
            label="Bluetooth"
            onPressedChange={resolve}
            pressed
          />,
        );
        userEvent
          .click(screen.getByRole("button", { name: "Bluetooth" }))
          .catch(() => {
            /* no-op */
          });
      });
      expect(asked).toBe(false);
    });

    it("opens its details from the arrow", async () => {
      const opened = await new Promise((resolve) => {
        render(
          <QuickTile
            icon={<span />}
            label="Bluetooth"
            onMore={() => {
              resolve(true);
            }}
            onPressedChange={() => undefined}
            pressed
          />,
        );
        userEvent
          .click(screen.getByRole("button", { name: "Bluetooth details" }))
          .catch(() => {
            /* no-op */
          });
      });
      expect(opened).toBe(true);
    });

    it("opens its details from the whole tile when it has no toggle", async () => {
      const opened = await new Promise((resolve) => {
        render(
          <QuickTile
            detail="Connected"
            icon={<span />}
            label="Wired"
            onMore={() => {
              resolve(true);
            }}
          />,
        );
        userEvent
          .click(screen.getByRole("button", { name: "Wired details" }))
          .catch(() => {
            /* no-op */
          });
      });
      expect(opened).toBe(true);
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
  });
});
