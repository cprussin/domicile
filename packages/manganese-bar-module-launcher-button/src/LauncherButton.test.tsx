import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LauncherButton } from "./LauncherButton";

describe("LauncherButton", () => {
  it("opens the launcher", async () => {
    await new Promise<void>((resolve) => {
      render(<LauncherButton onOpen={resolve} />);
      fireEvent.click(screen.getByRole("button", { name: "Launcher" }));
    });
  });

  it("names itself on hover", async () => {
    render(<LauncherButton onOpen={() => undefined} />);
    await userEvent.hover(screen.getByRole("button", { name: "Launcher" }));
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Launcher");
  });
});
