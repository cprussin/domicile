import { describe, expect, it } from "bun:test";
import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import { WorkspacesContext } from "@domicile-desktop/manganese-window-management/workspaces-context";
import { fireEvent, render, screen } from "@testing-library/react";

import { WorkspaceSwitcher } from "./bar-item";

/** The switcher on screen `left`, showing workspace 2 of 1 and 2. */
const switcher = (toggleOverview: () => void) =>
  render(
    <BarContext value={{ locked: false, popsUp: false, screen: "left" }}>
      <WorkspacesContext
        value={{
          current: { left: "2" },
          focused: "left",
          homes: { "1": "left", "2": "left" },
          mode: "default",
          overviewOpen: false,
          select: () => undefined,
          toggleOverview,
        }}
      >
        <WorkspaceSwitcher />
      </WorkspacesContext>
    </BarContext>,
  );

describe("WorkspaceSwitcher", () => {
  it("opens the overview from the button before the workspaces", async () => {
    await new Promise<void>((resolve) => {
      switcher(resolve);
      const [first] = screen.getAllByRole("button");
      expect(first).toBe(screen.getByRole("button", { name: "Overview" }));
      fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    });
  });
});
