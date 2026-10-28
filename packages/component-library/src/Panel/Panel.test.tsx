import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Panel, PanelAction } from "./Panel";

describe(Panel, () => {
  describe("rendering", () => {
    it("titles its content", () => {
      render(
        <Panel title="Bluetooth">
          <p>the devices</p>
        </Panel>,
      );
      expect(
        screen.getByRole("heading", { name: "Bluetooth" }),
      ).toBeInTheDocument();
      expect(screen.getByText("the devices")).toBeInTheDocument();
    });

    it("says when it is drawn at a popover's usual width, so the stylesheet can size it", () => {
      const { container } = render(
        <Panel title="Bluetooth" width="standard">
          <p>the devices</p>
        </Panel>,
      );
      expect(container.firstElementChild).toHaveAttribute(
        "data-width",
        "standard",
      );
    });

    it("puts its content's controls in its header, beside its title", async () => {
      render(
        <Panel title="Wi-Fi">
          <PanelAction>
            <button type="button">Scan</button>
          </PanelAction>
          <p>the networks</p>
        </Panel>,
      );
      const scan = await screen.findByRole("button", { name: "Scan" });
      expect(
        screen.getByRole("heading", { name: "Wi-Fi" }).parentElement,
      ).toContainElement(scan);
    });

    it("leaves controls in place outside a panel", () => {
      render(
        <PanelAction>
          <button type="button">Scan</button>
        </PanelAction>,
      );
      expect(screen.getByRole("button", { name: "Scan" })).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("goes back", async () => {
      const backed = new Promise((resolve) => {
        render(
          <Panel
            onBack={() => {
              resolve(true);
            }}
            title="Sound"
          >
            <p>the mixer</p>
          </Panel>,
        );
      });
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(await backed).toBe(true);
    });
  });
});
