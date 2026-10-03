import { describe, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { LauncherButton } from "./LauncherButton";

describe("LauncherButton", () => {
  it("opens the launcher", async () => {
    await new Promise<void>((resolve) => {
      render(<LauncherButton onOpen={resolve} />);
      fireEvent.click(screen.getByRole("button", { name: "Launcher" }));
    });
  });
});
