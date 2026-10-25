import { describe, expect, it } from "bun:test";
import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import { render, screen } from "@testing-library/react";

import type { KeymapPress } from "./KeymapNotice";
import { KeymapNotice } from "./KeymapNotice";

/** The notice for `press`, on the right of two monitors. */
const notice = (press: KeymapPress | undefined) => (
  <DisplayProvider
    source={{
      displays: [
        { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
        { name: "right", position: [1920, 0], scale: 1, size: [2560, 1440] },
      ],
      onDisplays: () => () => undefined,
    }}
  >
    <KeymapNotice press={press} screen="right" />
  </DisplayProvider>
);

describe("KeymapNotice", () => {
  it("names the keymap switched to", () => {
    render(notice({ count: 1, description: "English (US)", keymap: "us" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "KeymapusEnglish (US)",
    );
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("stays up and updates on the next press", () => {
    const { rerender } = render(
      notice({ count: 1, description: undefined, keymap: "us" }),
    );
    const shown = screen.getByRole("status");

    rerender(notice({ count: 2, description: undefined, keymap: "dvp" }));

    expect(screen.getByRole("status")).toBe(shown);
    expect(shown).toHaveTextContent("Keymapdvp");
  });

  it("shows on the screen it is asked for", () => {
    render(notice({ count: 1, description: undefined, keymap: "us" }));

    const box = screen.getByRole("status").parentElement;
    expect(box).toHaveStyle({ left: "1920px", width: "2560px" });
  });

  it("shows nothing before a keymap is switched", () => {
    render(notice(undefined));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
