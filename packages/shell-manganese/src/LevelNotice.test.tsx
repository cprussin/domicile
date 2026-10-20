import { describe, expect, it } from "bun:test";
import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import { render, screen } from "@testing-library/react";

import { LevelNotice } from "./LevelNotice";
import { LevelKind } from "./media-keys";

/** The notice for `kind` at 40%, on the right of two monitors. */
const renderAt = (kind: LevelKind, muted = false) =>
  render(
    <DisplayProvider
      source={{
        displays: [
          { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
          { name: "right", position: [1920, 0], scale: 1, size: [2560, 1440] },
        ],
        onDisplays: () => () => undefined,
      }}
    >
      <LevelNotice
        press={{ count: 1, level: { kind, level: 0.4, muted } }}
        screen="right"
      />
    </DisplayProvider>,
  );

describe("LevelNotice", () => {
  it.each([
    [LevelKind.Volume, "Volume 40%"],
    [LevelKind.Microphone, "Microphone 40%"],
    [LevelKind.Brightness, "Brightness 40%"],
  ])("shows level %d as %s", (kind, text) => {
    renderAt(kind);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "40");
  });

  it("says muted and grays the meter", () => {
    renderAt(LevelKind.Volume, true);

    expect(screen.getByRole("status")).toHaveTextContent("Volume muted");
    expect(screen.getByRole("meter")).toHaveAttribute("data-muted");
  });

  it("shows on the screen it is asked for", () => {
    renderAt(LevelKind.Volume);

    const box = screen.getByRole("status").parentElement;
    expect(box).toHaveStyle({ left: "1920px", width: "2560px" });
  });

  it("shows nothing before a key is pressed", () => {
    render(<LevelNotice press={undefined} screen="right" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
