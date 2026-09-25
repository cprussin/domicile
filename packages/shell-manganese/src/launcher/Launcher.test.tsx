import { describe, expect, it, spyOn } from "bun:test";
import { FilePreview } from "@domicile/chrome-sdk/file-preview";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Launcher } from "./Launcher";
import { Launch } from "./launch";

const FILES = ["Notes/2026/april.org", "Notes/today.org", "src/", "todo.txt"];

/**
 * The host's search over a home of `files`, sending at most two hundred of
 * what matched the way the compositor does — every word, any order, any case.
 */
const searching =
  (files: readonly string[], indexing: boolean) => (query: string) => {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== "");
    const matched = files.filter((path) =>
      words.every((word) => path.toLowerCase().includes(word)),
    );
    return Promise.resolve({
      files: matched.slice(0, 200),
      indexing,
      matched: matched.length,
      query,
    });
  };

/** What the host says each path holds: its own name, as text. */
const previewing = (path: string) =>
  Promise.resolve({
    path,
    preview:
      path === "src"
        ? FilePreview.Directory(["domicile/", "README.md"])
        : FilePreview.Text(`contents of ${path}`),
  });

/** The panel open over a home with those files in it, recording what it launched. */
const launcher = (files: readonly string[] = FILES, indexing = false) => {
  const launched: Launch[] = [];
  const dismissed: true[] = [];
  render(
    <Launcher
      onDismiss={() => {
        dismissed.push(true);
      }}
      onLaunch={(launch) => {
        launched.push(launch);
      }}
      open
      preview={previewing}
      search={searching(files, indexing)}
    />,
  );
  return {
    box: () =>
      screen.getByRole("combobox", { name: "Open a file, a URL, or search" }),
    dismissed,
    launched,
    /** The rows, as they read, once the host has answered what the box says. */
    rows: async () =>
      (await screen.findAllByRole("option")).map((row) => row.textContent),
    user: userEvent.setup(),
  };
};

/** The pane showing what the highlighted row is. */
const previewPane = () => screen.getByRole("region", { name: "Preview" });

describe("Launcher", () => {
  it("shows nothing at all while it is shut", () => {
    render(
      <Launcher
        onDismiss={() => undefined}
        onLaunch={() => undefined}
        open={false}
        preview={previewing}
        search={searching(FILES, false)}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens wide, so the rows and a preview both have room", () => {
    launcher();

    expect(screen.getByRole("dialog").getAttribute("data-size")).toBe("xl");
  });

  it("offers what the host found, named before it is placed", async () => {
    // A path is read from its end: the name is what was typed part of and the
    // directories above it are only there to tell two files of that name
    // apart, so a row is the two of them in that order rather than one line
    // of text handed to `text-overflow`. Nothing separates them in
    // `textContent` because what separates them on screen is the row's gap.
    const panel = launcher();

    expect(await panel.rows()).toStrictEqual([
      "april.orgNotes/2026",
      "today.orgNotes",
      "src",
      "todo.txt",
    ]);
  });

  it("asks the host about what the box says", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "notes");

    expect(await panel.rows()).toStrictEqual([
      "april.orgNotes/2026",
      "today.orgNotes",
      "Search for notes",
    ]);
  });

  it("offers a URL above the file it names, and a search below both", async () => {
    // A URL typed whole is a URL meant, so it is on top — but the file of the
    // same name and a search for the words are both still one arrow away.
    const panel = launcher(["example.com"]);

    await panel.user.type(panel.box(), "example.com");

    expect(await panel.rows()).toStrictEqual([
      "Go to https://example.com",
      "example.com",
      "Search for example.com",
    ]);
  });

  it("searches for a name that matched a file, when that row is chosen", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "today");
    await panel.rows();
    await panel.user.keyboard("{ArrowDown}{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://google.com/search?q=today"),
    ]);
  });

  it("edits the file that was clicked", async () => {
    const panel = launcher();

    await panel.user.click(
      await screen.findByRole("option", { name: "todo.txt" }),
    );

    expect(panel.launched).toStrictEqual([Launch.Edited("todo.txt")]);
  });

  it("edits a directory without the slash the host marked it with", async () => {
    const panel = launcher();

    await panel.user.click(await screen.findByRole("option", { name: "src" }));

    expect(panel.launched).toStrictEqual([Launch.Edited("src")]);
  });

  it("edits the first match on Enter, which is what typing a name is for", async () => {
    // The whole reason the list is ranked at all: a person types enough of a
    // name to see it at the top and presses Enter without ever looking at the
    // keyboard again.
    const panel = launcher();

    await panel.user.type(panel.box(), "today");
    await panel.rows();
    await panel.user.keyboard("{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Edited("Notes/today.org")]);
  });

  it("edits the row the arrow keys walked to instead", async () => {
    const panel = launcher();

    await panel.user.type(panel.box(), "notes");
    await panel.rows();
    await panel.user.keyboard("{ArrowDown}{Enter}");

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

    expect(await screen.findByText("2 matched")).toBeInTheDocument();
  });

  describe("the preview", () => {
    it("shows what the highlighted file holds", async () => {
      const panel = launcher();

      await panel.user.type(panel.box(), "today");

      expect(
        await within(previewPane()).findByText("contents of Notes/today.org"),
      ).toBeInTheDocument();
    });

    it("shows what the highlighted directory holds", async () => {
      const panel = launcher();

      await panel.user.type(panel.box(), "src");

      expect(
        await within(previewPane()).findByText("README.md"),
      ).toBeInTheDocument();
    });

    it("shows the highlighted site in a view of its own", async () => {
      const panel = launcher();

      await panel.user.type(panel.box(), "example.com");

      expect(
        (await within(previewPane()).findByTitle("https://example.com"))
          .tagName,
      ).toBe("WEBVIEW");
    });

    it("follows the highlight onto a search", async () => {
      const panel = launcher();

      await panel.user.type(panel.box(), "today");
      await panel.rows();
      await panel.user.keyboard("{ArrowDown}");

      expect(
        await within(previewPane()).findByTitle(
          "https://google.com/search?q=today",
        ),
      ).toBeInTheDocument();
    });

    it("shows nothing while no row is highlighted", async () => {
      // An empty box has chosen nothing, and previewing whatever sorted to the
      // top of the home would be the launcher choosing for it.
      const panel = launcher();
      await panel.rows();

      expect(previewPane()).toBeEmptyDOMElement();
    });
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

    await panel.rows();
    await panel.user.type(panel.box(), "{ArrowDown}{ArrowDown}");
    scrollIntoView.mockRestore();

    expect(scrolled.at(-1)).toBe("today.orgNotes");
  });

  it("says so while the desktop is still working out what there is", async () => {
    // WITHOUT THIS THE PANEL LIES BY OMISSION. A list that is a third of a
    // home looks exactly like a home with a third as much in it, so a person
    // who types the name of a file the walk has not reached is told they do
    // not have it — and the evidence that they are wrong is nowhere on screen.
    launcher(["src"], true);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Still finding your files",
    );
  });

  it("says nothing about an index that is not being built", async () => {
    // Which is every launcher after the first seconds of a session. A notice
    // that stayed up would be a panel that never stops apologizing.
    const panel = launcher();
    await panel.rows();

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

  it("draws what the host sent and counts everything it matched", async () => {
    // A HOME IS A HUNDRED THOUSAND PATHS. The host sends the front of what
    // matched rather than all of it — the rows past it are not rows anybody
    // scrolls to, what narrows the list is typing — and the counter beside the
    // box says how many there really are, so the front is never mistaken for
    // the answer.
    const home = Array.from({ length: 500 }, (_, at) => `file-${String(at)}`);
    const panel = launcher(home);

    expect(await panel.rows()).toHaveLength(200);
    expect(screen.getByText("500 matched")).toBeInTheDocument();
  });

  it("keeps the arrow keys inside the rows it drew", async () => {
    // The walk is over what is on screen rather than over what matched, which
    // is what makes the cap above safe: an Up press onto the bottom of the
    // list has to land on the last row that exists, not on the five hundredth
    // match that was never drawn.
    const home = Array.from({ length: 500 }, (_, at) => `file-${String(at)}`);
    const panel = launcher(home);

    await panel.rows();
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
