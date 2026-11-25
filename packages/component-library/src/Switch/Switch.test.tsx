import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
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

  describe("disabled", () => {
    loadEmittedStylesheet(
      document,
      new URL("../../styled-system/styles.css", import.meta.url),
    );

    const styleOf = (element: Element) => globalThis.getComputedStyle(element);

    it("fades its track", () => {
      render(<Switch checked disabled label="Locked" />);
      expect(Number(styleOf(screen.getByRole("switch")).opacity)).toBeLessThan(
        1,
      );
    });

    it("flattens its knob", () => {
      render(<Switch disabled label="Locked" />);
      const thumb = screen.getByRole("switch").firstElementChild;
      expect(thumb).not.toBeNull();
      expect(styleOf(thumb as Element).boxShadow).toBe("none");
    });

    it("refuses the pointer on its label", () => {
      render(<Switch disabled label="Locked" />);
      expect(styleOf(screen.getByText("Locked")).cursor).toBe("not-allowed");
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
