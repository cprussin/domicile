import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PanelHeader } from "./PanelHeader";

describe(PanelHeader, () => {
  describe("rendering", () => {
    it("titles the panel, with its controls at the end", () => {
      render(
        <PanelHeader
          action={<button type="button">Scan</button>}
          title="Network"
        />,
      );
      expect(
        screen.getByRole("heading", { level: 2, name: "Network" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Scan" })).toBeInTheDocument();
    });

    it("has no back button with nowhere to go back to", () => {
      render(<PanelHeader title="Notifications" />);
      expect(
        screen.queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("goes back", async () => {
      const backed = new Promise((resolve) => {
        render(
          <PanelHeader
            onBack={() => {
              resolve(true);
            }}
            title="Messages"
          />,
        );
      });
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(await backed).toBe(true);
    });
  });
});
