import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { PanelSection } from "./PanelSection";

describe(PanelSection, () => {
  describe("rendering", () => {
    it("is a region named by its label, which heads it", () => {
      render(
        <PanelSection label="Inboxes">
          <p>PrussinNet</p>
        </PanelSection>,
      );
      const section = screen.getByRole("region", { name: "Inboxes" });
      expect(section).toContainElement(
        screen.getByRole("heading", { level: 3, name: "Inboxes" }),
      );
      expect(section).toContainElement(screen.getByText("PrussinNet"));
    });

    it("puts its controls beside its label", () => {
      render(
        <PanelSection
          action={<button type="button">Scan</button>}
          label="Wi-Fi"
        >
          <p>Home</p>
        </PanelSection>,
      );
      expect(screen.getByRole("region", { name: "Wi-Fi" })).toContainElement(
        screen.getByRole("button", { name: "Scan" }),
      );
    });
  });
});
