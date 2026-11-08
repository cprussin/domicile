import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { LauncherButton } from "./LauncherButton";

describe("LauncherButton", () => {
  it("opens the launcher", async () => {
    await new Promise<void>((resolve) => {
      render(<LauncherButton onOpen={resolve} />);
      fireEvent.click(screen.getByRole("button", { name: "Launcher" }));
    });
  });

  // Four squares are the workspace switcher's overview button.
  it("shows a sparkle", () => {
    const { container } = render(<LauncherButton onOpen={() => undefined} />);
    expect(container.querySelector("[data-part=star]")).not.toBeNull();
  });

  it("names itself on hover", async () => {
    render(<LauncherButton onOpen={() => undefined} />);
    await userEvent.hover(screen.getByRole("button", { name: "Launcher" }));
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Launcher");
  });

  // A negative margin shrinks the width its bar slot measures, which then
  // clips the button's end, hover background included.
  it("keeps all of itself inside its bar slot", () => {
    render(<LauncherButton onOpen={() => undefined} />);
    expect(
      screen.getByRole("button", { name: "Launcher" }).className,
    ).not.toContain(css({ marginInlineEnd: -4 }));
  });
});
