import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ZoomPanel } from "./ZoomPanel";

const IGNORE = () => undefined;

describe(ZoomPanel, () => {
  it("says the page's zoom", () => {
    render(
      <ZoomPanel
        onZoomIn={IGNORE}
        onZoomOut={IGNORE}
        onZoomReset={IGNORE}
        zoom={1.25}
      />,
    );
    expect(screen.getByRole("group", { name: "Zoom" })).toHaveTextContent(
      "125%",
    );
  });

  it("zooms in, out and back to 100%", async () => {
    const pressed: string[] = [];
    render(
      <ZoomPanel
        onZoomIn={() => {
          pressed.push("in");
        }}
        onZoomOut={() => {
          pressed.push("out");
        }}
        onZoomReset={() => {
          pressed.push("reset");
        }}
        zoom={1.25}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(pressed).toStrictEqual(["in", "out", "reset"]);
  });

  it("grays out what cannot go further", () => {
    render(
      <ZoomPanel
        onZoomIn={IGNORE}
        onZoomOut={IGNORE}
        onZoomReset={IGNORE}
        zoom={5}
      />,
    );
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  });

  // A popup closes when focus falls out of it, and a browser drops focus off
  // a button the moment it gets the `disabled` attribute. Reset grays itself
  // out as it is pressed, so it must gray out without losing focus.
  it.each([
    ["Reset", 1],
    ["Zoom in", 5],
    ["Zoom out", 0.25],
  ])("keeps %s focusable while grayed out", (name, zoom) => {
    render(
      <ZoomPanel
        onZoomIn={IGNORE}
        onZoomOut={IGNORE}
        onZoomReset={IGNORE}
        zoom={zoom}
      />,
    );
    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
  });
});
