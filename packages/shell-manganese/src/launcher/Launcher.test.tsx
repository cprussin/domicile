import { describe, expect, it, spyOn } from "bun:test";
import { FilePreview } from "@domicile/chrome-sdk/file-preview";
import type { Bookmark, DesktopEntry } from "@domicile/chrome-sdk/host-message";
import { WEBVIEW_GUEST_FOCUS_EVENT } from "@domicile/chrome-sdk/webview-element";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/ssr/BookmarkSimple";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { GoogleLogoIcon } from "@phosphor-icons/react/dist/ssr/GoogleLogo";
import { YoutubeLogoIcon } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadEmittedStylesheet } from "../emitted-stylesheet";
import { Launcher } from "./Launcher";
import { Launch } from "./launch";
import { WikipediaLogoIcon } from "./WikipediaLogoIcon";

const FILES = ["Notes/2026/april.org", "Notes/today.org", "src/", "todo.txt"];

/** An application the machine has installed, as the host would describe it. */
const EDITOR: DesktopEntry = {
  command: ["gedit", "--new-window"],
  comment: "Edit text files",
  icon: undefined,
  id: "org.gnome.gedit.desktop",
  name: "Text Editor",
  preview: undefined,
};

/** An application whose icon the host found. */
const PAINT: DesktopEntry = {
  command: ["paint"],
  comment: "",
  icon: "data:image/png;base64,cm93",
  id: "paint.desktop",
  name: "Paint",
  preview: undefined,
};

/** A bookmark the desk offers. */
const MAIL: Bookmark = {
  icon: undefined,
  name: "Mail",
  url: "https://mail.example.com",
};

/**
 * The host's search over the applications `apps` and the bookmarks
 * `bookmarks`, by every word of a name.
 */
const searchingApps =
  (apps: readonly DesktopEntry[], bookmarks: readonly Bookmark[]) =>
  (query: string) => {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== "");
    const named = (name: string) =>
      words.every((word) => name.toLowerCase().includes(word));
    return Promise.resolve({
      apps: apps.filter((app) => named(app.name)),
      bookmarks: bookmarks.filter((bookmark) => named(bookmark.name)),
      query,
    });
  };

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

/** Every path the panel asked the host to preview, in order. */
const previewed: string[] = [];

/** What the host says each path holds: its own name, as text. */
const previewing = (path: string) => {
  previewed.push(path);
  return Promise.resolve({
    path,
    preview: holding(path),
  });
};

/** What the home the tests run over has in each path. */
const holding = (path: string): FilePreview => {
  if (path === "src") {
    return FilePreview.Directory(["domicile/", "README.md"]);
  } else if (path === "Pictures") {
    return FilePreview.Directory(["cat.png", "2026/", "notes.txt"]);
  } else if (path === "src/main.ts") {
    return FilePreview.Text('const a = "b";');
  } else if (path === "Music/song.flac" || path === "Music/take") {
    return FilePreview.Audio({
      album: "Record",
      artist: "Band",
      cover: "data:image/png;base64,AQID",
      duration: 61.5,
      title: "Song",
    });
  } else if (path === "empty") {
    return FilePreview.Directory([]);
  } else if (path.endsWith(".bin") || path === "Music/noise.mp3") {
    return FilePreview.Binary();
  } else {
    return FilePreview.Text(`contents of ${path}`);
  }
};

/**
 * The panel open over a home with those files in it, recording what it
 * launched.
 *
 * Held with `using`, which takes the panel down as the test's last statement
 * returns. The shared `afterEach` cleanup comes too late: the panel always has
 * something in flight — the host's answer, the highlight settling into a
 * preview — and a timer that comes due between a test and its `afterEach`
 * updates the panel outside `act`.
 */
const launcher = (
  files: readonly string[] = FILES,
  indexing = false,
  apps: readonly DesktopEntry[] = [],
  bookmarks: readonly Bookmark[] = [],
) => {
  previewed.length = 0;
  const launched: Launch[] = [];
  const dismissed: true[] = [];
  const { unmount } = render(
    <Launcher
      here
      onClosed={() => undefined}
      onDismiss={() => {
        dismissed.push(true);
      }}
      onLaunch={(launch) => {
        launched.push(launch);
      }}
      open
      opening={{ apps, bookmarks }}
      preview={previewing}
      search={searching(files, indexing)}
      searchApps={searchingApps(apps, bookmarks)}
    />,
  );
  return {
    [Symbol.dispose]: unmount,
    box: () =>
      screen.getByRole("combobox", {
        name: "Open an app, a file, a URL, or search",
      }),
    dismissed,
    launched,
    /** The rows, as they read, once the host has answered what the box says. */
    rows: async () =>
      (await screen.findAllByRole("option")).map((row) => row.textContent),
    user: userEvent.setup(),
  };
};

/** What `icon` draws, without the `<svg>` around it that sizes it. */
const glyphOf = (icon: ReactElement): string =>
  new DOMParser().parseFromString(renderToStaticMarkup(icon), "image/svg+xml")
    .documentElement.innerHTML;

/** The pane showing what the highlighted row is. */
loadEmittedStylesheet(document);

const previewPane = () => screen.getByRole("region", { name: "Preview" });

describe("Launcher", () => {
  it("shows nothing at all while it is shut", () => {
    render(
      <Launcher
        here
        onClosed={() => undefined}
        onDismiss={() => undefined}
        onLaunch={() => undefined}
        open={false}
        opening={{ apps: [], bookmarks: [] }}
        preview={previewing}
        search={searching(FILES, false)}
        searchApps={searchingApps([], [])}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens wide, so the rows and a preview both have room", () => {
    using _panel = launcher();

    expect(screen.getByRole("dialog").getAttribute("data-size")).toBe("xl");
  });

  it("offers what the host found, each name under the directory it is in", async () => {
    // A path is read from its end: the name is what was typed part of and the
    // directories above it are only there to tell two files of that name
    // apart, so a row is the two of them apart rather than one line of text
    // handed to `text-overflow` — the directory a small line over the name,
    // which leaves the row's width to the preview beside it. Nothing
    // separates them in `textContent` because what separates them on screen
    // is the row's own lines.
    using panel = launcher();

    expect(await panel.rows()).toStrictEqual([
      "Notes/2026april.org",
      "Notestoday.org",
      "src",
      "todo.txt",
    ]);
  });

  it("asks the host about what the box says", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "notes");

    expect(await panel.rows()).toStrictEqual([
      "Notes/2026april.org",
      "Notestoday.org",
      "Search for notes",
    ]);
  });

  it("lights the letters typed without widening them", async () => {
    // A heavier weight is a wider letter, so a bold match would push the rest
    // of its row along with every key pressed.
    using panel = launcher();

    await panel.user.type(panel.box(), "notes");
    await panel.rows();
    const weightOf = (element: Element) =>
      globalThis.getComputedStyle(element).fontWeight;

    expect(
      screen.getAllByText("Notes", { selector: "mark" }).map(weightOf),
    ).toStrictEqual(["normal", "normal"]);
  });

  it("offers a URL above the file it names, and a search below both", async () => {
    // A URL typed whole is a URL meant, so it is on top — but the file of the
    // same name and a search for the words are both still one arrow away.
    using panel = launcher(["example.com"]);

    await panel.user.type(panel.box(), "example.com");

    expect(await panel.rows()).toStrictEqual([
      "Go to https://example.com",
      "example.com",
      "Search for example.com",
    ]);
  });

  it("draws the applications it opens onto without waiting on the host", () => {
    const { unmount } = render(
      <Launcher
        here
        onClosed={() => undefined}
        onDismiss={() => undefined}
        onLaunch={() => undefined}
        open
        opening={{ apps: [EDITOR], bookmarks: [MAIL] }}
        preview={previewing}
        search={() => new Promise(() => undefined)}
        searchApps={() => new Promise(() => undefined)}
      />,
    );

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toStrictEqual(["Text Editor", "Mail"]);
    unmount();
  });

  it("offers the applications above the files, and a search below both", async () => {
    using panel = launcher(["text.md"], false, [EDITOR]);

    await panel.user.type(panel.box(), "text");

    expect(await panel.rows()).toStrictEqual([
      "Text Editor",
      "text.md",
      "Search for text",
    ]);
  });

  it("draws an application with the icon its entry names", async () => {
    const panel = launcher([], false, [PAINT]);

    await panel.user.type(panel.box(), "paint");
    const [row] = await screen.findAllByRole("option");

    expect(row?.querySelector("img")?.getAttribute("src")).toBe(PAINT.icon);
  });

  it("draws an application whose icon was not found with a glyph", async () => {
    const panel = launcher([], false, [EDITOR]);

    await panel.user.type(panel.box(), "editor");
    const [row] = await screen.findAllByRole("option");

    expect(row?.querySelector("img")).toBeNull();
    expect(row?.querySelector("svg")?.innerHTML).toBe(
      glyphOf(<AppWindowIcon size={16} />),
    );
  });

  it("runs the application chosen", async () => {
    using panel = launcher([], false, [EDITOR]);

    await panel.user.type(panel.box(), "editor");
    await panel.rows();
    await panel.user.keyboard("{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Ran(["gedit", "--new-window"]),
    ]);
  });

  it("offers a bookmark below the applications and above the files", async () => {
    using panel = launcher(["mail.txt"], false, [], [MAIL]);

    await panel.user.type(panel.box(), "mail");

    expect(await panel.rows()).toStrictEqual([
      "Mail",
      "mail.txt",
      "Search for mail",
    ]);
  });

  it("draws a bookmark with the icon the host found for its site", async () => {
    const icon = "data:image/png;base64,aWNv";
    using panel = launcher([], false, [], [{ ...MAIL, icon }]);

    await panel.user.type(panel.box(), "mail");
    const [row] = await screen.findAllByRole("option");

    expect(row?.querySelector("img")?.getAttribute("src")).toBe(icon);
  });

  it("draws a bookmark whose site's icon was not found with a glyph", async () => {
    using panel = launcher([], false, [], [MAIL]);

    await panel.user.type(panel.box(), "mail");
    const [row] = await screen.findAllByRole("option");

    expect(row?.querySelector("img")).toBeNull();
    expect(row?.querySelector("svg")?.innerHTML).toBe(
      glyphOf(<BookmarkSimpleIcon size={16} />),
    );
  });

  it("draws a picture as itself, without the frame a glyph's tile has", async () => {
    // A site's or an application's icon is its own shape; a frame round it is
    // a box drawn round somebody else's logo.
    using panel = launcher([], false, [PAINT]);

    await panel.user.type(panel.box(), "paint");
    const [row] = await screen.findAllByRole("option");
    const picture = row?.querySelector("img")?.parentElement;
    if (picture === null || picture === undefined) {
      throw new Error("the row drew no picture");
    } else {
      // `data-row-tile` is the framed tile, which a reached row recolors.
      expect(picture.hasAttribute("data-row-tile")).toBe(false);
    }
  });

  it("browses to the bookmark chosen", async () => {
    using panel = launcher([], false, [], [MAIL]);

    await panel.user.type(panel.box(), "mail");
    await panel.rows();
    await panel.user.keyboard("{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://mail.example.com"),
    ]);
  });

  it("offers a tagged search on its engine above the rows the line gets", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "!wiki notes");

    expect(await panel.rows()).toStrictEqual([
      "Search for notes on Wikipedia",
      "Search for !wiki notes",
    ]);
  });

  it("offers the page a !gh name goes to, then a search for it on GitHub", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "!gh cprussin");

    expect(await panel.rows()).toStrictEqual([
      "Go to cprussin on GitHub",
      "Search for cprussin on GitHub",
      "Search for !gh cprussin",
    ]);
  });

  it.each([
    ["!gh", <GithubLogoIcon key="gh" size={16} />],
    ["!im", <GoogleLogoIcon key="im" size={16} />],
    ["!maps", <GoogleLogoIcon key="maps" size={16} />],
    ["!wiki", <WikipediaLogoIcon key="wiki" size={16} />],
    ["!yt", <YoutubeLogoIcon key="yt" size={16} />],
  ])(
    "draws a %s search with the logo of the site it searches",
    async (tag, logo) => {
      using panel = launcher();

      await panel.user.type(panel.box(), `${tag} kate bush`);
      const [tagged] = await screen.findAllByRole("option");

      expect(tagged?.querySelector("svg")?.innerHTML).toBe(glyphOf(logo));
    },
  );

  it("searches for a name that matched a file, when that row is chosen", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "today");
    await panel.rows();
    await panel.user.keyboard("{ArrowDown}{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://google.com/search?q=today"),
    ]);
  });

  it("edits the file that was clicked", async () => {
    using panel = launcher();

    await panel.user.click(
      await screen.findByRole("option", { name: "todo.txt" }),
    );

    expect(panel.launched).toStrictEqual([Launch.Opened("todo.txt")]);
  });

  it("edits a directory without the slash the host marked it with", async () => {
    using panel = launcher();

    await panel.user.click(await screen.findByRole("option", { name: "src" }));

    expect(panel.launched).toStrictEqual([Launch.Opened("src")]);
  });

  it("edits the first match on Enter, which is what typing a name is for", async () => {
    // The whole reason the list is ranked at all: a person types enough of a
    // name to see it at the top and presses Enter without ever looking at the
    // keyboard again.
    using panel = launcher();

    await panel.user.type(panel.box(), "today");
    await panel.rows();
    await panel.user.keyboard("{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Opened("Notes/today.org")]);
  });

  it("edits the row the arrow keys walked to instead", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "notes");
    await panel.rows();
    await panel.user.keyboard("{ArrowDown}{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Opened("Notes/today.org")]);
  });

  it("highlights the first row as it opens", async () => {
    using panel = launcher();
    await panel.rows();

    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves the highlight to the row the pointer is over", async () => {
    // One highlight rather than a hover beside it: the row the pointer is on
    // is the row Enter takes.
    using panel = launcher();
    await panel.rows();

    await panel.user.hover(screen.getByText("todo.txt"));
    await panel.user.keyboard("{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Opened("todo.txt")]);
  });

  it("browses a URL that matched no file", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "example.com{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://example.com"),
    ]);
  });

  it("searches for words that are neither a file nor a URL", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "!yt kate bush{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed(
        "https://www.youtube.com/results?search_query=kate%20bush",
      ),
    ]);
  });

  it("goes to the repository a !gh name is", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "!gh cprussin/domicile{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Browsed("https://github.com/cprussin/domicile"),
    ]);
  });

  it("counts how much of the home is still answering", async () => {
    // The one number that says whether another letter is worth typing, in the
    // field doing the narrowing.
    using panel = launcher();

    await panel.user.type(panel.box(), "notes");

    expect(await screen.findByText("2 matched")).toBeInTheDocument();
  });

  describe("the preview", () => {
    it("shows what the highlighted file holds", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "today");

      expect(
        await within(previewPane()).findByText("contents of Notes/today.org"),
      ).toBeInTheDocument();
    });

    it("scrolls with the wheel", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "today");
      await within(previewPane()).findByText("contents of Notes/today.org");
      fireEvent.wheel(previewPane(), { deltaY: 120 });

      expect(previewPane().scrollTop).toBe(120);
    });

    it("lets the pointer into a site, so it can be scrolled", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "example.com");
      const view = await within(previewPane()).findByTitle(
        "https://example.com",
      );

      expect(globalThis.getComputedStyle(view).pointerEvents).not.toBe("none");
    });

    it("gives the keyboard back to the box when a site takes it", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "example.com");
      const view = await within(previewPane()).findByTitle(
        "https://example.com",
      );
      panel.box().blur();
      view.dispatchEvent(
        new Event(WEBVIEW_GUEST_FOCUS_EVENT, { bubbles: true }),
      );

      expect(panel.box()).toHaveFocus();
    });

    it("waits for the typing to settle before it asks", async () => {
      // Every keystroke moves the highlight, and a preview per keystroke is a
      // file read, or a page loaded, and thrown away per keystroke.
      using panel = launcher();

      await panel.user.type(panel.box(), "today");
      await within(previewPane()).findByText("contents of Notes/today.org");

      expect(previewed).toStrictEqual(["Notes/today.org"]);
    });

    it("shows the highlighted image as itself, served from home", async () => {
      // The engine draws what the host cannot send: `domicile://home/` is the
      // home, to the shell's own document only.
      using panel = launcher(["Pictures/cat.png"]);

      await panel.user.type(panel.box(), "cat");

      expect(
        (await within(previewPane()).findByRole("img")).getAttribute("src"),
      ).toBe("domicile://home/Pictures/cat.png");
    });

    it("shows the highlighted PDF bare, without the viewer's toolbar or sidebar", async () => {
      // A preview is a glance at the page, and the viewer's chrome is most of
      // a pane this size.
      using panel = launcher(["Scratch/DS11_Complete.pdf"]);

      await panel.user.type(panel.box(), "DS11");

      expect(
        (
          await within(previewPane()).findByTitle("DS11_Complete.pdf")
        ).getAttribute("src"),
      ).toBe("domicile://home/Scratch/DS11_Complete.pdf#toolbar=0&navpanes=0");
    });

    it("lights a file's code by what each piece of it is", async () => {
      // A word for what the text is, and the pane's own colors for the word,
      // so a light desk and a dark one both read.
      using panel = launcher(["src/main.ts"]);

      await panel.user.type(panel.box(), "main");

      expect(
        (await within(previewPane()).findByText("const")).getAttribute(
          "data-scope",
        ),
      ).toBe("keyword");
      expect(
        within(previewPane()).getByText('"b"').getAttribute("data-scope"),
      ).toBe("string");
    });

    it("heads a folder with its name and what it holds, folders first", async () => {
      using panel = launcher(["Pictures/"]);

      await panel.user.type(panel.box(), "Pictures");

      expect(
        await within(previewPane()).findByRole("heading", { name: "Pictures" }),
      ).toBeInTheDocument();
      expect(previewPane()).toHaveTextContent("1 folder · 2 files");
      expect(
        within(previewPane())
          .getAllByRole("listitem")
          .map((entry) => entry.textContent),
      ).toStrictEqual(["2026", "cat.png", "notes.txt"]);
    });

    it("draws the pictures in a folder as themselves", async () => {
      using panel = launcher(["Pictures/"]);

      await panel.user.type(panel.box(), "Pictures");

      expect(
        (
          await within(previewPane()).findByRole("img", { name: "cat.png" })
        ).getAttribute("src"),
      ).toBe("domicile://home/Pictures/cat.png");
    });

    it("shows a song by what it says of itself, and offers to play it", async () => {
      using panel = launcher(["Music/song.flac"]);

      await panel.user.type(panel.box(), "song");

      const pane = within(previewPane());
      expect(
        await pane.findByRole("heading", { name: "Song" }),
      ).toBeInTheDocument();
      expect(previewPane()).toHaveTextContent("Band");
      expect(previewPane()).toHaveTextContent("Record");
      expect(previewPane()).toHaveTextContent("1:01");
      expect(
        pane.getByRole("img", { name: "Cover art" }).getAttribute("src"),
      ).toBe("data:image/png;base64,AQID");
      expect(pane.getByLabelText("Play song.flac").getAttribute("src")).toBe(
        "domicile://home/Music/song.flac",
      );
    });

    it("still offers to play a song that says nothing of itself", async () => {
      using panel = launcher(["Music/noise.mp3"]);

      await panel.user.type(panel.box(), "noise");

      expect(
        await within(previewPane()).findByRole("heading", {
          name: "noise.mp3",
        }),
      ).toBeInTheDocument();
      expect(
        within(previewPane()).getByLabelText("Play noise.mp3"),
      ).toBeInTheDocument();
    });

    it("shows a song the host heard, whatever its name says", async () => {
      using panel = launcher(["Music/take"]);

      await panel.user.type(panel.box(), "take");

      expect(
        await within(previewPane()).findByLabelText("Play take"),
      ).toBeInTheDocument();
    });

    it("shows a video that does not say how long it is from its start", async () => {
      using panel = launcher(["Videos/clip.webm"]);

      await panel.user.type(panel.box(), "clip");
      const video = await within(previewPane()).findByLabelText("clip.webm");
      Object.defineProperty(video, "duration", {
        value: Number.POSITIVE_INFINITY,
      });
      fireEvent.loadedMetadata(video);

      expect((video as HTMLVideoElement).currentTime).toBe(0);
      expect(previewPane()).not.toHaveTextContent(/\d:\d\d/);
    });

    it("shows a video as a still from a way into it, not playing", async () => {
      // The first frame of most videos is black, and a preview that starts
      // playing is not a preview.
      using panel = launcher(["Videos/clip.mp4"]);

      await panel.user.type(panel.box(), "clip");
      const video = await within(previewPane()).findByLabelText("clip.mp4");
      Object.defineProperty(video, "duration", { value: 100 });
      fireEvent.loadedMetadata(video);

      expect(video).toBeInstanceOf(HTMLVideoElement);
      expect((video as HTMLVideoElement).autoplay).toBe(false);
      expect((video as HTMLVideoElement).currentTime).toBe(10);
      expect(
        await within(previewPane()).findByText("1:40"),
      ).toBeInTheDocument();
    });

    it("shows what the highlighted directory holds", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "src");

      expect(
        await within(previewPane()).findByText("README.md"),
      ).toBeInTheDocument();
    });

    it("says so for a directory with nothing in it", async () => {
      // An empty list is an answer, and a blank pane would read as one still
      // on its way.
      using panel = launcher(["empty/"]);

      await panel.user.type(panel.box(), "empty");

      expect(
        await within(previewPane()).findByText("Empty folder"),
      ).toBeInTheDocument();
    });

    it("shows the highlighted site in a view of its own", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "example.com");

      expect(
        (await within(previewPane()).findByTitle("https://example.com"))
          .tagName,
      ).toBe("WEBVIEW");
    });

    it("shows the highlighted bookmark in a view of its own", async () => {
      using panel = launcher([], false, [], [MAIL]);

      await panel.user.type(panel.box(), "mail");

      expect(
        (await within(previewPane()).findByTitle("https://mail.example.com"))
          .tagName,
      ).toBe("WEBVIEW");
    });

    it("follows the highlight onto a search", async () => {
      using panel = launcher();

      await panel.user.type(panel.box(), "today");
      await panel.rows();
      await panel.user.keyboard("{ArrowDown}");

      expect(
        await within(previewPane()).findByTitle(
          "https://google.com/search?q=today",
        ),
      ).toBeInTheDocument();
    });

    it("says what the highlighted application is and what it runs", async () => {
      using panel = launcher([], false, [EDITOR]);

      await panel.user.type(panel.box(), "editor");

      expect(
        await within(previewPane()).findByText("gedit --new-window"),
      ).toBeInTheDocument();
      expect(previewPane()).toHaveTextContent("Text Editor");
      expect(previewPane()).toHaveTextContent("Edit text files");
    });

    it("shows the highlighted application's icon", async () => {
      const panel = launcher([], false, [PAINT]);

      await panel.user.type(panel.box(), "paint");

      expect(
        (await within(previewPane()).findByText("Paint")).parentElement
          ?.querySelector("img")
          ?.getAttribute("src"),
      ).toBe(PAINT.icon);
    });

    it("shows the picture of itself the highlighted application names", async () => {
      const picture = "data:image/svg+xml;base64,PHN2Zz4=";
      using panel = launcher([], false, [{ ...PAINT, preview: picture }]);

      await panel.user.type(panel.box(), "paint");

      expect(
        (await within(previewPane()).findByRole("img")).getAttribute("src"),
      ).toBe(picture);
    });

    it("is most of the screen tall, so there is room to see what it shows", () => {
      using _panel = launcher();

      expect(globalThis.getComputedStyle(previewPane()).blockSize).toBe("60vh");
    });

    it("says what to do while there is no row to highlight", async () => {
      // The pane is never blank, because a blank pane reads as a broken one.
      using _panel = launcher([]);

      expect(
        await within(previewPane()).findByText("Nothing selected"),
      ).toBeInTheDocument();
    });

    it("names a file it cannot draw, and says why", async () => {
      using panel = launcher(["firmware.bin"]);

      await panel.user.type(panel.box(), "firmware");

      expect(
        await within(previewPane()).findByText("No preview for this file"),
      ).toBeInTheDocument();
      expect(previewPane()).toHaveTextContent("firmware.bin");
    });

    it("keeps the last preview until the highlight settles on another row", async () => {
      // A preview, then the next one: not the next row's name in between, which
      // is a flash of a pane that says less than the one it replaced.
      using panel = launcher();

      await panel.user.type(panel.box(), "notes");
      await within(previewPane()).findByText(
        "contents of Notes/2026/april.org",
      );
      await panel.user.keyboard("{ArrowDown}");

      expect(previewPane()).toHaveTextContent(
        "contents of Notes/2026/april.org",
      );
      expect(
        await within(previewPane()).findByText("contents of Notes/today.org"),
      ).toBeInTheDocument();
    });

    it("names a file the engine could not draw after all", async () => {
      // An extension is a guess: a `.png` that is not one is an image that
      // fails to load, and a pane showing a broken image is a blank pane.
      using panel = launcher(["Pictures/cat.png"]);

      await panel.user.type(panel.box(), "cat");
      fireEvent.error(await within(previewPane()).findByRole("img"));

      expect(
        await within(previewPane()).findByText("No preview for this file"),
      ).toBeInTheDocument();
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
    using panel = launcher();

    await panel.rows();
    await panel.user.type(panel.box(), "{ArrowDown}");
    scrollIntoView.mockRestore();

    expect(scrolled.at(-1)).toBe("Notestoday.org");
  });

  it("says so while the desktop is still working out what there is", async () => {
    // WITHOUT THIS THE PANEL LIES BY OMISSION. A list that is a third of a
    // home looks exactly like a home with a third as much in it, so a person
    // who types the name of a file the walk has not reached is told they do
    // not have it — and the evidence that they are wrong is nowhere on screen.
    using _panel = launcher(["src"], true);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Still finding your files",
    );
  });

  it("says so under the last row, not under the panel", async () => {
    // It is about the rows, so it sits where the rows run out: the end of the
    // list is where a person looking for a file that is not there yet looks.
    using panel = launcher(["src", "Notes/today.org"], true);
    await panel.rows();

    const status = await screen.findByRole("status");

    expect(
      screen.getAllByRole("option").at(-1)?.compareDocumentPosition(status),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(status.compareDocumentPosition(previewPane())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("says nothing about an index that is not being built", async () => {
    // Which is every launcher after the first seconds of a session. A notice
    // that stayed up would be a panel that never stops apologizing.
    using panel = launcher();
    await panel.rows();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens a path that is typed whole, index or no index", async () => {
    // The escape hatch that makes a half-built index usable rather than
    // merely honest: a leading `~/` or `/` cannot be a hostname or a search
    // anybody meant, so it needs no list to be confident about — and a person
    // who knows where their file is should never have to wait for a walk to
    // agree with them.
    using panel = launcher([], true);

    await panel.user.type(panel.box(), "~/Scratch{Enter}");

    expect(panel.launched).toStrictEqual([Launch.Opened("Scratch")]);
  });

  it("draws what the host sent and counts everything it matched", async () => {
    // A HOME IS A HUNDRED THOUSAND PATHS. The host sends the front of what
    // matched rather than all of it — the rows past it are not rows anybody
    // scrolls to, what narrows the list is typing — and the counter beside the
    // box says how many there really are, so the front is never mistaken for
    // the answer.
    const home = Array.from({ length: 500 }, (_, at) => `file-${String(at)}`);
    using panel = launcher(home);

    expect(await panel.rows()).toHaveLength(200);
    expect(screen.getByText("500 matched")).toBeInTheDocument();
  });

  it("keeps the arrow keys inside the rows it drew", async () => {
    // Clamped rather than wrapped, at both ends: an Up press past the top of
    // two hundred rows that jumped to the bottom would lose the user's place.
    using panel = launcher();

    await panel.rows();
    await panel.user.keyboard("{ArrowUp}{Enter}");
    await panel.user.keyboard("{ArrowDown>6/}{Enter}");

    expect(panel.launched).toStrictEqual([
      Launch.Opened("Notes/2026/april.org"),
      Launch.Opened("todo.txt"),
    ]);
  });

  it("walks the rows with ctrl+n and ctrl+p as well as the arrow keys", async () => {
    // The Emacs and readline walk, for hands that never leave the home row.
    using panel = launcher();

    await panel.rows();
    await panel.user.keyboard(
      "{Control>}n{/Control}{Control>}n{/Control}{Control>}p{/Control}{Enter}",
    );

    expect(panel.launched).toStrictEqual([Launch.Opened("Notes/today.org")]);
  });

  it("keeps the keyboard in the box on Tab", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "today");
    await within(previewPane()).findByText("contents of Notes/today.org");
    await panel.user.tab();
    await panel.user.tab({ shift: true });

    expect(panel.box()).toHaveFocus();
  });

  it("keeps the keyboard in the box when the panel is clicked", async () => {
    using panel = launcher();

    await panel.user.type(panel.box(), "today");
    await panel.user.click(
      await within(previewPane()).findByText("contents of Notes/today.org"),
    );

    expect(panel.box()).toHaveFocus();
  });

  it("says it was dismissed when Escape closes it", async () => {
    // The panel does not close itself: what is open is desktop state, so the
    // dialog reports the press and the desktop decides. A panel that closed
    // itself would be a second copy of that state, and the two would part
    // company the first time `mod+space` was pressed over a closed one.
    using panel = launcher();

    await panel.user.keyboard("{Escape}");

    expect(panel.dismissed).toStrictEqual([true]);
  });
});
