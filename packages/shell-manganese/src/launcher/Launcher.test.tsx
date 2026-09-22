import { describe, expect, it, spyOn } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Launcher } from "./Launcher";
import { Launch } from "./launch";

const FILES = ["Notes/2026/april.org", "Notes/today.org", "src", "todo.txt"];

/** The panel open over a home with those files in it, recording what it launched. */
const launcher = (files: readonly string[] = FILES) => {
  const launched: Launch[] = [];
  const dismissed: true[] = [];
  render(
    <Launcher
      files={files}
      onDismiss={() => {
        dismissed.push(true);
      }}
      onLaunch={(launch) => {
        launched.push(launch);
      }}
      open
    />,
  );
  return {
    box: () =>
      screen.getByRole("combobox", { name: "Open a file, a URL, or search" }),
    dismissed,
    launched,
    user: userEvent.setup(),
  };
};

/**
 * The line under the list saying what Enter would do, read whole.
 *
 * `getByText` matches an element's own text nodes, and this line is a glyph,
 * a verb and what the verb is about — so it is the paragraph's `textContent`
 * that has the sentence in it.
 */
const promised = () => screen.getByRole("paragraph").textContent;

describe("Launcher", () => {
  it("shows nothing at all while it is shut", () => {
    render(
      <Launcher
        files={FILES}
        onDismiss={() => undefined}
        onLaunch={() => undefined}
        open={false}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers every file it was handed, named before it is placed", () => {
    // A path is read from its end: the name is what was typed part of and the
    // directories above it are only there to tell two files of that name
    // apart, so a row is the two of them in that order rather than one line
    // of text handed to `text-overflow`. Nothing separates them in
    // `textContent` because what separates them on screen is the grid's gap.
    launcher();

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual([
      "april.orgNotes/2026",
      "today.orgNotes",
      "src",
      "todo.txt",
    ]);
  });

  it("narrows to the files still being asked about", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "notes");

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(["april.orgNotes/2026", "today.orgNotes"]);
  });

  it("edits the file that was clicked", async () => {
    const panel = launcher();

    await panel.user.click(screen.getByRole("option", { name: "todo.txt" }));

    expect(panel.launched).toStrictEqual([Launch.Edited("todo.txt")]);
  });

  it("edits the first match on Enter, which is what typing a name is for", () => {
    // The whole reason the list is ranked at all: a person types enough of a
    // name to see it at the top and presses Enter without ever looking at the
    // keyboard again.
    const panel = launcher();

    return panel.user.type(panel.box(), "today{Enter}").then(() => {
      expect(panel.launched).toStrictEqual([Launch.Edited("Notes/today.org")]);
    });
  });

  it("edits the row the arrow keys walked to instead", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "notes{ArrowDown}{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Edited("Notes/today.org")]);
  });

  it("launches nothing on Enter over an empty box", async () => {
    // Even though every file is on screen and one of them is first. An empty
    // box is a person who has not decided, and opening whatever sorted to the
    // top of their home would be the launcher deciding for them.
    const panel = launcher();

    await panel.user.type(panel.box(), "{Enter}");

    expect(panel.launched).toStrictEqual([]);
  });

  it("browses a URL that matched no file", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "example.com{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://example.com"),
    ]);
  });

  it("searches for words that are neither a file nor a URL", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "!yt kate bush{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed(
        "https://www.youtube.com/results?search_query=kate%20bush",
      ),
    ]);
  });

  it("counts how much of the home is still answering", async () => {
    // The one number that says whether another letter is worth typing, in the
    // field doing the narrowing.
    const panel = launcher();

    await panel.user.type(panel.box(), "notes");

    expect(screen.getByText("2 of 4")).toBeInTheDocument();
  });

  it("says what Enter would do with a query no file matches", async () => {
    // The one thing a panel with an empty list cannot otherwise show: the
    // box still does something on Enter, and what that is is the whole
    // question the user is holding while they type.
    const panel = launcher();

    await panel.user.type(panel.box(), "example.com");

    expect(promised()).toBe("Go to https://example.com");
  });

  it("brings the row the arrow keys reached into view", async () => {
    // A home is longer than the list is tall, so a walk that scrolled nothing
    // would leave the highlight below the fold — the keyboard moving
    // something the user cannot see.
    const scrolled: (string | null)[] = [];
    const scrollIntoView = spyOn(
      Element.prototype,
      "scrollIntoView",
    ).mockImplementation(function (this: Element) {
      scrolled.push(this.textContent);
    });
    const panel = launcher();

    await panel.user.type(panel.box(), "{ArrowDown}{ArrowDown}");
    scrollIntoView.mockRestore();

    expect(scrolled.at(-1)).toBe("today.orgNotes");
  });

  it("says it was dismissed when Escape closes it", async () => {
    // The panel does not close itself: what is open is desktop state, so the
    // dialog reports the press and the desktop decides. A panel that closed
    // itself would be a second copy of that state, and the two would part
    // company the first time `mod+space` was pressed over a closed one.
    const panel = launcher();

    await panel.user.keyboard("{Escape}");

    expect(panel.dismissed).toStrictEqual([true]);
  });
});
