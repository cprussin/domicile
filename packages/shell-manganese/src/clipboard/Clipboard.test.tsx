import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OnOneScreen, SCREEN } from "../screens/fixture";
import { Clipboard } from "./Clipboard";

const HISTORY = [
  { id: 3, preview: "ssh-rsa AAAAB3NzaC1yc2E" },
  { id: 2, preview: "https://example.invalid/a/long/address" },
  { id: 1, preview: "the first thing copied" },
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

  it("lists what was copied, newest first", () => {
    // Kept in the compositor's order, newest first; the panel does not sort.
    clipboard();

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(HISTORY.map(({ preview }) => preview));
  });

  it("copies the row that was clicked, and closes behind it", () => {
    // Choosing closes the panel so the user can paste.
    const panel = clipboard();

    screen.getByRole("option", { name: "the first thing copied" }).click();

    expect(panel.copied).toStrictEqual([1]);
    expect(panel.dismissed).toStrictEqual([true]);
  });

  it("copies the row the keyboard walked to", async () => {
    // Down from no highlight lands on the newest entry.
    const panel = clipboard();

    await panel.user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(panel.copied).toStrictEqual([2]);
  });

  it("says a desktop nothing was copied on is empty", () => {
    // Not an empty box, which looks unloaded. This is normal right after the
    // desktop starts, since the history does not survive a restart.
    clipboard([]);

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing has been copied yet")).toBeDefined();
  });
});
