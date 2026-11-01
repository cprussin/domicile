import { describe, expect, it } from "bun:test";
import {
  OnOneScreen,
  SCREEN,
} from "@domicile-desktop/manganese-window-management/screens/fixture";
import type { ClipboardEntry } from "@domicile-desktop/sdk/desktop/clipboard";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Clipboard } from "./Clipboard";

/** A row's text, with no picture. */
const text = (id: number, preview: string): ClipboardEntry => ({
  id,
  image: false,
  preview,
  thumbnail: undefined,
});

const HISTORY = [
  text(3, "https://example.invalid/a/long/address"),
  text(2, "Thanks, see you\nTuesday"),
  text(1, "the first thing copied"),
];

/** The panel open over that history, recording copy requests. */
const clipboard = (entries = HISTORY) => {
  const copied: number[] = [];
  const dismissed: true[] = [];
  render(
    <Clipboard
      entries={entries}
      onCopy={(entry) => {
        copied.push(entry);
      }}
      onDismiss={() => {
        dismissed.push(true);
      }}
      open
      screen={SCREEN}
    />,
    { wrapper: OnOneScreen },
  );
  return { copied, dismissed, user: userEvent.setup() };
};

/** Each row's text. */
const rows = () =>
  screen.getAllByRole("option").map((row) => row.textContent ?? "");

describe("Clipboard", () => {
  it("shows nothing at all while it is shut", () => {
    render(
      <Clipboard
        entries={HISTORY}
        onCopy={() => undefined}
        onDismiss={() => undefined}
        open={false}
        screen={SCREEN}
      />,
      { wrapper: OnOneScreen },
    );

    expect(screen.queryByRole("option")).toBeNull();
  });

  describe("rows", () => {
    it("lists what was copied newest first, each on one line", () => {
      // Kept in the compositor's order; the panel does not sort. A line
      // break would turn a row into a paragraph.
      clipboard();

      expect(rows()).toStrictEqual([
        "https://example.invalid/a/long/addressOn the clipboard now",
        "Thanks, see you Tuesday",
        "the first thing copied",
      ]);
    });

    it("shows a copied image's thumbnail", () => {
      const thumbnail = "data:image/png;base64,iVBORw0KGgo=";
      clipboard([{ id: 4, image: true, preview: "Image, 3 × 2", thumbnail }]);

      const row = screen.getByRole("option", { name: /^Image, 3 × 2/ });
      expect(row.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
    });

    it("counts the copies", () => {
      clipboard();

      expect(screen.getByText("3 copies")).toBeDefined();
    });

    it("says a desktop nothing was copied on is empty", () => {
      // Usual right after the desktop starts, since the history does not
      // survive a restart. There is nothing to search, so no box.
      clipboard([]);

      expect(screen.getByText("Nothing copied yet")).toBeDefined();
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  describe("keyboard", () => {
    it("starts on the copy before the current one", async () => {
      // The newest is already on the clipboard, so Enter alone swaps back.
      const panel = clipboard();

      await panel.user.keyboard("{Enter}");

      expect(panel.copied).toStrictEqual([2]);
      expect(panel.dismissed).toStrictEqual([true]);
    });

    it("starts on the only copy when there is one", async () => {
      const panel = clipboard([text(7, "alone")]);

      await panel.user.keyboard("{Enter}");

      expect(panel.copied).toStrictEqual([7]);
    });

    it("copies the row the arrows walked to", async () => {
      const panel = clipboard();

      await panel.user.keyboard("{ArrowDown}{Enter}");

      expect(panel.copied).toStrictEqual([1]);
    });

    it("narrows to the copies holding every typed word, and takes the first", async () => {
      const panel = clipboard();

      await panel.user.keyboard("tues THANKS");

      expect(rows()).toStrictEqual(["Thanks, see you Tuesday"]);
      expect(screen.getByText("1 matched")).toBeDefined();
      await panel.user.keyboard("{Enter}");
      expect(panel.copied).toStrictEqual([2]);
    });

    it("says when nothing matches", async () => {
      const panel = clipboard();

      await panel.user.keyboard("zebra");

      expect(screen.queryByRole("option")).toBeNull();
      expect(screen.getByText("Nothing copied matches")).toBeDefined();
    });
  });

  it("copies the row that was clicked, and closes behind it", async () => {
    // Choosing closes the panel so the user can paste.
    const panel = clipboard();

    await panel.user.click(
      screen.getByRole("option", { name: "the first thing copied" }),
    );

    expect(panel.copied).toStrictEqual([1]);
    expect(panel.dismissed).toStrictEqual([true]);
  });
});
