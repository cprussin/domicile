import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Clipboard } from "./Clipboard";

const HISTORY = [
  { id: 3, preview: "ssh-rsa AAAAB3NzaC1yc2E" },
  { id: 2, preview: "https://example.invalid/a/long/address" },
  { id: 1, preview: "the first thing copied" },
];

/** The panel open over that history, recording what it was asked to copy. */
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
    />,
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
      />,
    );

    expect(screen.queryByRole("option")).toBeNull();
  });

  it("lists what was copied, newest first", () => {
    // The order is the compositor's and is not sorted again here: the last
    // thing copied is the one most likely to be wanted, and a panel that
    // re-ordered it would be inventing a second rule for that.
    clipboard();

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(HISTORY.map(({ preview }) => preview));
  });

  it("copies the row that was clicked, and closes behind it", () => {
    // Closing is the whole gesture: a person opens this to paste something,
    // and a panel still up over the window they are about to paste into has
    // not finished the job.
    const panel = clipboard();

    screen.getByRole("option", { name: "the first thing copied" }).click();

    expect(panel.copied).toStrictEqual([1]);
    expect(panel.dismissed).toStrictEqual([true]);
  });

  it("copies the row the keyboard walked to", async () => {
    // Down from nothing lands on the newest, which is the row a person who
    // opened this and pressed a key meant.
    const panel = clipboard();

    await panel.user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(panel.copied).toStrictEqual([2]);
  });

  it("says a desktop nothing was copied on is empty", () => {
    // Rather than an empty box, which reads as a panel that has not loaded.
    // It is the ordinary state of a desktop that has just started: the
    // history is the compositor's memory and nothing outlives a restart.
    clipboard([]);

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing has been copied yet")).toBeDefined();
  });
});
