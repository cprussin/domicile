import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { PanelFooter } from "./PanelFooter";

describe(PanelFooter, () => {
  describe("rendering", () => {
    it("ends the panel with its summary and action", () => {
      render(
        <PanelFooter action={<button type="button">Clear all</button>}>
          2 notifications
        </PanelFooter>,
      );
      const footer = screen.getByRole("contentinfo");
      expect(footer).toHaveTextContent("2 notifications");
      expect(footer).toContainElement(
        screen.getByRole("button", { name: "Clear all" }),
      );
    });
  });
});
