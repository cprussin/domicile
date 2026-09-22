import { describe, expect, it, spyOn } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Launcher } from "./Launcher";
import { Launch } from "./launch";

const FILES = ["Notes/2026/april.org", "Notes/today.org", "src", "todo.txt"];

/** The panel open over a home with those files in it, recording what it launched. */
const launcher = (files: readonly string[] = FILES, indexing = false) => {
  const launched: Launch[] = [];
  const dismissed: true[] = [];
  render(
    <Launcher
      files={files}
      indexing={indexing}
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
        indexing={false}
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

  it("says so while the desktop is still working out what there is", () => {
    // WITHOUT THIS THE PANEL LIES BY OMISSION. A list that is a third of a
    // home looks exactly like a home with a third as much in it, so a person
    // who types the name of a file the walk has not reached is told they do
    // not have it — and the evidence that they are wrong is nowhere on screen.
    launcher(["src"], true);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Still finding your files",
    );
  });

  it("says nothing about an index that is not being built", () => {
    // Which is every launcher after the first seconds of a session. A notice
    // that stayed up would be a panel that never stops apologizing.
    launcher();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens a path that is typed whole, index or no index", async () => {
    // The escape hatch that makes a half-built index usable rather than
    // merely honest: a leading `~/` or `/` cannot be a hostname or a search
    // anybody meant, so it needs no list to be confident about — and a person
    // who knows where their file is should never have to wait for a walk to
    // agree with them.
    const panel = launcher([], true);

    await panel.user.type(panel.box(), "~/Scratch{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Edited("Scratch")]);
  });

  it("draws a bounded number of rows however big the home is", () => {
    // A HOME IS A HUNDRED THOUSAND PATHS NOW. The list used to be a few
    // hundred because the walk stopped a level down; an index of the whole
    // home, drawn a row per path, is a panel that hangs the shell on the
    // keystroke that opens it. The rows past the cap are not rows anybody
    // scrolls to — what narrows the list is typing — and the counter beside
    // the box still says how many there really are, so the cap is never
    // mistaken for the answer.
    const home = Array.from({ length: 500 }, (_, at) => `file-${String(at)}`);

    launcher(home);

    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(screen.getByText("500 of 500")).toBeInTheDocument();
  });

  it("keeps the arrow keys inside the rows it drew", async () => {
    // The walk is over what is on screen rather than over what matched, which
    // is what makes the cap above safe: an Up press onto the bottom of the
    // list has to land on the last row that exists, not on the five hundredth
    // match that was never drawn.
    const home = Array.from({ length: 500 }, (_, at) => `file-${String(at)}`);
    const panel = launcher(home);

    await panel.user.keyboard("{ArrowUp}{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Edited("file-199")]);
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
