import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePicker } from "./FilePicker";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";
import type { Folders } from "./folders";

const HOME = "/home/someone";

/**
 * A fake filesystem by absolute path. Directory names end in `/`; missing
 * paths are unreadable.
 */
const FILESYSTEM: ReadonlyMap<string, readonly string[]> = new Map([
  ["/", ["home/", "tmp/"]],
  ["/home", ["someone/"]],
  [HOME, ["Documents/", "Pictures/", "Scratch/", "notes.txt", ".bashrc"]],
  [`${HOME}/Documents`, ["report.pdf"]],
  [`${HOME}/Pictures`, ["cat.png", "dog.png", "trips/"]],
  [`${HOME}/Pictures/trips`, []],
  [`${HOME}/Scratch`, ["draft.md"]],
  ["/tmp", []],
]);

/**
 * Folders over a copy of {@link FILESYSTEM}. `change` replaces a directory's
 * entries and tells its watchers; `create` adds a directory unless the name
 * is taken.
 */
const foldersOf = () => {
  const tree = new Map(FILESYSTEM);
  const watchers = new Map<string, () => void>();
  const change = (path: string, entries: readonly string[]) => {
    tree.set(path, entries);
    act(() => {
      watchers.get(path)?.();
    });
  };
  const folders: Folders = {
    create: (path) => {
      const cut = path.lastIndexOf("/");
      const parent = path.slice(0, cut);
      const name = path.slice(cut + 1);
      const entries = tree.get(parent) ?? [];
      if (entries.includes(name) || entries.includes(`${name}/`)) {
        return Promise.resolve(
          Err<"created", SystemError>({
            kind: SystemErrorKind.AlreadyExists,
            message: "File exists",
          }),
        );
      } else {
        tree.set(parent, [...entries, `${name}/`]);
        tree.set(path, []);
        return Promise.resolve(Ok<"created", SystemError>("created"));
      }
    },
    list: (path) => {
      const entries = tree.get(path);
      return entries === undefined
        ? Promise.reject(new DOMException(path, "NotReadableError"))
        : Promise.resolve(entries);
    },
    watch: (path, changed) => {
      watchers.set(path, changed);
      return () => {
        watchers.delete(path);
      };
    },
  };
  return { change, folders };
};

/** The chosen paths, or `undefined` on cancel. */
type Answer = readonly string[] | undefined;

/**
 * Renders a picker for `mode` and returns its answer. A picker that never
 * answers makes the test time out.
 */
const picker = (
  mode: ChooserMode,
  request: Partial<FileRequest> = {},
): Promise<Answer> =>
  new Promise((resolve) => {
    render(
      <FilePicker
        request={{
          accept: [],
          cancel: () => {
            resolve(undefined);
          },
          choose: resolve,
          folders: foldersOf().folders,
          home: HOME,
          mode,
          suggestedName: "",
          ...request,
        }}
      />,
    );
  });

const box = (): HTMLElement =>
  screen.getByRole("combobox", { name: "Filter or go to a path" });

/** The rows' accessible names, once the current directory is listed. */
const rows = async (): Promise<readonly string[]> => {
  await act(() => Promise.resolve());
  return screen
    .queryAllByRole("option")
    .map((row) => row.getAttribute("aria-label") ?? "");
};

const nameBox = (): HTMLElement =>
  screen.getByRole("combobox", { name: "Name" });

const places = (): HTMLElement =>
  screen.getByRole("navigation", { name: "Places" });

/** The current directory, as the path bar shows it. */
const where = (): readonly string[] =>
  within(screen.getByRole("navigation", { name: "Path" }))
    .getAllByRole("button")
    .map((crumb) => crumb.textContent);

const selection = (): HTMLElement =>
  screen.getByRole("status", { name: "Selection" });

/** Whether the picker has not answered yet. */
const unanswered = async (answered: Promise<Answer>): Promise<boolean> =>
  Promise.race([
    answered.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 0);
    }),
  ]);

/** Cancels with Escape, from wherever in the picker focus is. */
const cancel = async (answered: Promise<Answer>) => {
  act(() => {
    screen.getByRole("button", { name: "Cancel" }).focus();
  });
  await userEvent.keyboard("{Escape}");
  await answered;
};

describe("FilePicker", () => {
  describe("walking", () => {
    it("starts in the home, with the way up first", async () => {
      const answered = picker(ChooserMode.Open);

      expect(await rows()).toStrictEqual([
        "..",
        "Documents",
        "Pictures",
        "Scratch",
        "notes.txt",
      ]);
      expect(where()).toStrictEqual(["~"]);
      await cancel(answered);
    });

    it("opens a directory typed and entered", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "Scratch{Enter}");

      expect(where()).toStrictEqual(["~", "Scratch"]);
      expect(await rows()).toStrictEqual(["..", "draft.md"]);
      expect(box()).toHaveValue("");
      await cancel(answered);
    });

    it("walks a path typed with slashes", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "Pictures/trips/");

      expect(where()).toStrictEqual(["~", "Pictures", "trips"]);
      await userEvent.type(box(), "../");
      expect(where()).toStrictEqual(["~", "Pictures"]);
      await cancel(answered);
    });

    it("goes up with `..`, with Backspace, and by clicking `..`", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.type(box(), "Pictures/trips/");

      await userEvent.type(box(), "..{Enter}");
      expect(where()).toStrictEqual(["~", "Pictures"]);

      await userEvent.type(box(), "{Backspace}");
      expect(where()).toStrictEqual(["~"]);

      await rows();
      await userEvent.click(screen.getByRole("option", { name: ".." }));
      expect(where()).toStrictEqual(["/", "home"]);
      await cancel(answered);
    });

    it("goes to the root with a slash, and home with a tilde", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "/");
      expect(where()).toStrictEqual(["/"]);
      expect(await rows()).toStrictEqual(["home", "tmp"]);

      await userEvent.type(box(), "~/");
      expect(where()).toStrictEqual(["~"]);
      await cancel(answered);
    });

    it("opens a directory that is clicked, and one in the path bar", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.click(screen.getByRole("option", { name: "Pictures" }));
      await rows();
      await userEvent.click(screen.getByRole("option", { name: "trips" }));
      expect(where()).toStrictEqual(["~", "Pictures", "trips"]);

      await userEvent.click(
        within(screen.getByRole("navigation", { name: "Path" })).getByRole(
          "button",
          { name: "Pictures" },
        ),
      );
      expect(where()).toStrictEqual(["~", "Pictures"]);
      await cancel(answered);
    });

    // Home, the standard folders that exist, and root.
    it("goes to a place in the sidebar", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      expect(
        within(places())
          .getAllByRole("button")
          .map((place) => place.textContent),
      ).toStrictEqual(["Home", "Documents", "Pictures", "Computer"]);
      await userEvent.click(
        within(places()).getByRole("button", { name: "Pictures" }),
      );
      expect(where()).toStrictEqual(["~", "Pictures"]);
      expect(
        within(places()).getByRole("button", { name: "Pictures" }),
      ).toHaveAttribute("aria-current", "location");

      await userEvent.click(
        within(places()).getByRole("button", { name: "Computer" }),
      );
      expect(where()).toStrictEqual(["/"]);
      await cancel(answered);
    });

    it("says what kind of file each row is", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      expect(
        screen.getByRole("option", { name: "notes.txt" }),
      ).toHaveTextContent("TXT document");
      expect(
        screen.getByRole("option", { name: "Pictures" }),
      ).toHaveTextContent("Folder");
      await cancel(answered);
    });

    it("shows what starts with a dot once a dot is typed", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), ".b");

      expect(await rows()).toStrictEqual([".bashrc"]);
      await cancel(answered);
    });

    it("shows hidden files while the button or Ctrl+H turns them on", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      act(() => {
        box().focus();
      });
      const hidden = screen.getByRole("button", { name: "Hidden files" });
      expect(hidden).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(hidden);

      expect(hidden).toHaveAttribute("aria-pressed", "true");
      expect(await rows()).toContain(".bashrc");
      expect(box()).toHaveFocus();
      await userEvent.type(box(), "{Control>}h{/Control}");
      expect(await rows()).not.toContain(".bashrc");
      await cancel(answered);
    });

    it("shows what changes in the folder while it is open", async () => {
      const { change, folders } = foldersOf();
      const answered = picker(ChooserMode.Open, { folders });
      await userEvent.type(box(), "Scratch{Enter}");
      await rows();

      change(`${HOME}/Scratch`, ["draft.md", "final.md"]);

      expect(await rows()).toStrictEqual(["..", "draft.md", "final.md"]);
      await cancel(answered);
    });

    it("goes to a path typed in the path box, opened with Ctrl+L or its button", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "{Control>}l{/Control}");
      const path = screen.getByRole("textbox", { name: "Path" });
      expect(path).toHaveFocus();
      expect(path).toHaveValue("~/");
      await userEvent.type(path, "Pictures/trips{Enter}");

      expect(where()).toStrictEqual(["~", "Pictures", "trips"]);
      expect(box()).toHaveFocus();

      await userEvent.click(
        screen.getByRole("button", { name: "Type a path" }),
      );
      await userEvent.clear(screen.getByRole("textbox", { name: "Path" }));
      await userEvent.type(
        screen.getByRole("textbox", { name: "Path" }),
        "/tmp{Enter}",
      );
      expect(where()).toStrictEqual(["/", "tmp"]);
      await cancel(answered);
    });

    it("puts the path box away on Escape, and stays open", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.type(box(), "{Control>}l{/Control}");
      expect(screen.getByRole("textbox", { name: "Path" })).toHaveFocus();

      await userEvent.keyboard("{Escape}");

      expect(
        screen.queryByRole("textbox", { name: "Path" }),
      ).not.toBeInTheDocument();
      expect(box()).toHaveFocus();
      expect(await unanswered(answered)).toBe(true);
      await cancel(answered);
    });

    it("starts in the folder the request names", async () => {
      const answered = picker(ChooserMode.Open, {
        currentFolder: `${HOME}/Pictures`,
      });

      expect(await rows()).toStrictEqual(["..", "trips", "cat.png", "dog.png"]);
      expect(where()).toStrictEqual(["~", "Pictures"]);
      await cancel(answered);
    });

    it("says so when a directory cannot be read, and still goes up", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "/root/");

      expect(await screen.findByText("Can't open this folder")).toBeVisible();
      expect(await rows()).toStrictEqual([".."]);
      await cancel(answered);
    });
  });

  describe("opening a file", () => {
    it("offers only the files the request takes", async () => {
      const answered = picker(ChooserMode.Open, { accept: ["pdf"] });
      await rows();

      await userEvent.type(box(), "Documents/");

      expect(await rows()).toStrictEqual(["..", "report.pdf"]);
      await cancel(answered);
    });

    // The first group applies until another is picked.
    it("offers the files of the filter group picked", async () => {
      const answered = picker(ChooserMode.Open, {
        filters: [
          { extensions: ["png"], name: "Images" },
          { extensions: ["pdf", "txt"], name: "Text" },
        ],
      });

      expect(await rows()).toStrictEqual([
        "..",
        "Documents",
        "Pictures",
        "Scratch",
      ]);
      await userEvent.click(
        screen.getByRole("combobox", { name: "File type" }),
      );
      await userEvent.click(screen.getByRole("option", { name: "Text" }));
      expect(await rows()).toStrictEqual([
        "..",
        "Documents",
        "Pictures",
        "Scratch",
        "notes.txt",
      ]);
      await cancel(answered);
    });

    it("starts with the filter group the request names, and says which chose", async () => {
      const chosen = new Promise<[Answer, number | undefined]>((resolve) => {
        render(
          <FilePicker
            request={{
              accept: [],
              cancel: () => {
                resolve([undefined, undefined]);
              },
              choose: (paths, filter) => {
                resolve([paths, filter]);
              },
              currentFilter: 1,
              filters: [
                { extensions: ["png"], name: "Images" },
                { extensions: ["txt"], name: "Text" },
              ],
              folders: foldersOf().folders,
              home: HOME,
              mode: ChooserMode.Open,
              suggestedName: "",
            }}
          />,
        );
      });

      expect(await rows()).toContain("notes.txt");
      await userEvent.dblClick(
        screen.getByRole("option", { name: "notes.txt" }),
      );
      expect(await chosen).toStrictEqual([[`${HOME}/notes.txt`], 1]);
    });

    it("has no filter groups to pick unless the request names some", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      expect(
        screen.queryByRole("combobox", { name: "File type" }),
      ).not.toBeInTheDocument();
      await cancel(answered);
    });

    it("chooses the file entered", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "notes{Enter}");

      expect(await answered).toStrictEqual([`${HOME}/notes.txt`]);
    });

    // A click selects a file but does not choose it.
    it("selects a file that is clicked, and says which", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.type(box(), "Pictures/");
      await rows();

      await userEvent.click(screen.getByRole("option", { name: "dog.png" }));

      expect(
        screen.getByRole("option", { name: "dog.png", selected: true }),
      ).toBeInTheDocument();
      expect(selection()).toHaveTextContent("~/Pictures/dog.png");
      expect(box()).toHaveFocus();
      await userEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(await answered).toStrictEqual([`${HOME}/Pictures/dog.png`]);
    });

    it("chooses a file that is double-clicked", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.dblClick(
        screen.getByRole("option", { name: "notes.txt" }),
      );

      expect(await answered).toStrictEqual([`${HOME}/notes.txt`]);
    });

    it("has nothing to open while a directory is selected", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
      expect(selection()).toHaveTextContent("Nothing selected");
      await cancel(answered);
    });
  });

  // As in fzf: Tab marks and moves on; Enter returns every mark, from any
  // directory.
  describe("opening several files", () => {
    it("chooses every file marked, across directories", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();
      await userEvent.type(box(), "notes{Tab}");
      await userEvent.clear(box());
      await userEvent.type(box(), "Pictures/");
      await rows();

      await userEvent.type(box(), "cat{Tab}");

      expect(selection()).toHaveTextContent("2 files");
      await userEvent.type(box(), "{Enter}");
      expect(await answered).toStrictEqual([
        `${HOME}/notes.txt`,
        `${HOME}/Pictures/cat.png`,
      ]);
    });

    it("marks a file that is clicked, and unmarks it clicked again", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();
      const notes = (selected: boolean) =>
        screen.queryByRole("option", { name: "notes.txt", selected });

      await userEvent.click(screen.getByRole("option", { name: "notes.txt" }));
      expect(notes(true)).toBeInTheDocument();
      expect(selection()).toHaveTextContent("1 file");

      await userEvent.click(screen.getByRole("option", { name: "notes.txt" }));
      expect(notes(false)).toBeInTheDocument();
      await cancel(answered);
    });
  });

  describe("choosing a folder", () => {
    it("offers no files, and chooses the folder it is in", async () => {
      const answered = picker(ChooserMode.OpenFolder);
      await rows();
      await userEvent.type(box(), "Pictures/");

      expect(await rows()).toStrictEqual(["..", "trips"]);
      expect(selection()).toHaveTextContent("~/Pictures");
      await userEvent.click(screen.getByRole("button", { name: "Choose" }));
      expect(await answered).toStrictEqual([`${HOME}/Pictures`]);
    });

    it("chooses with Ctrl+Enter, whatever is highlighted", async () => {
      const answered = picker(ChooserMode.OpenFolder);
      await rows();

      await userEvent.type(box(), "{Control>}{Enter}{/Control}");

      expect(await answered).toStrictEqual([HOME]);
    });
  });

  describe("saving", () => {
    it("names the file in its only box, and saves it where it is", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();

      expect(
        screen.queryByRole("combobox", { name: "Filter or go to a path" }),
      ).not.toBeInTheDocument();
      expect(nameBox()).toHaveValue("photo.png");
      await userEvent.type(nameBox(), "{Enter}");
      expect(await answered).toStrictEqual([`${HOME}/photo.png`]);
    });

    // So typing replaces the name and keeps the extension.
    it("selects the suggested name up to its extension", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();

      act(() => {
        nameBox().focus();
      });

      expect(nameBox()).toHaveProperty("selectionStart", 0);
      expect(nameBox()).toHaveProperty("selectionEnd", 5);
      await cancel(answered);
    });

    it("moves between folders with the arrows, and keeps the name", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();

      await userEvent.type(nameBox(), "{ArrowDown}{ArrowDown}{Enter}");
      expect(where()).toStrictEqual(["~", "Pictures"]);
      expect(nameBox()).toHaveValue("photo.png");

      await rows();
      await userEvent.type(nameBox(), "{ArrowUp}{Enter}");
      expect(where()).toStrictEqual(["~"]);

      await rows();
      await userEvent.type(nameBox(), "{Enter}");
      expect(await answered).toStrictEqual([`${HOME}/photo.png`]);
    });

    // Paths go in the path box, so a name is only a name.
    it("keeps a slash typed into the name, and saves nothing with one", async () => {
      const answered = picker(ChooserMode.Save);
      await rows();

      await userEvent.type(nameBox(), "10/23 notes.txt");

      expect(where()).toStrictEqual(["~"]);
      expect(nameBox()).toHaveValue("10/23 notes.txt");
      expect(screen.getByText("A name can't have a /")).toBeVisible();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await cancel(answered);
    });

    it("takes the name of a file that is clicked", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();

      await userEvent.click(screen.getByRole("option", { name: "notes.txt" }));

      expect(nameBox()).toHaveValue("notes.txt");
      await cancel(answered);
    });

    it("saves nothing without a name", async () => {
      const answered = picker(ChooserMode.Save);
      await rows();

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await answered).toBeUndefined();
    });

    it("saves nothing over a folder", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "Pictures" });
      await rows();

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByText("A folder has this name")).toBeVisible();
      await cancel(answered);
    });
  });

  describe("replacing a file", () => {
    it("asks first, and replaces it once told to", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "notes.txt" });
      await rows();
      expect(
        screen.getByText("Replaces the file with this name"),
      ).toBeVisible();

      await userEvent.type(nameBox(), "{Enter}");

      const asking = screen.getByRole("alertdialog", {
        name: "Replace “notes.txt”?",
      });
      expect(
        within(asking).getByRole("button", { name: "Replace" }),
      ).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      expect(await answered).toStrictEqual([`${HOME}/notes.txt`]);
    });

    it("goes back to the name on Escape", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "notes.txt" });
      await rows();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(nameBox()).toHaveFocus();
      await userEvent.clear(nameBox());
      await userEvent.type(nameBox(), "notes2.txt{Enter}");
      expect(await answered).toStrictEqual([`${HOME}/notes2.txt`]);
    });
  });

  describe("making a folder", () => {
    it("makes the folder named, and goes into it", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "a.txt" });
      await rows();

      await userEvent.click(screen.getByRole("button", { name: "New folder" }));
      const named = screen.getByRole("textbox", { name: "Folder name" });
      expect(named).toHaveFocus();
      await userEvent.type(named, "Drafts{Enter}");

      expect(
        await screen.findByRole("button", { name: "Drafts" }),
      ).toBeVisible();
      expect(where()).toStrictEqual(["~", "Drafts"]);
      expect(nameBox()).toHaveFocus();
      await userEvent.type(nameBox(), "{Enter}");
      expect(await answered).toStrictEqual([`${HOME}/Drafts/a.txt`]);
    });

    it("says why it could not, and keeps the name to fix", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.click(screen.getByRole("button", { name: "New folder" }));

      await userEvent.type(
        screen.getByRole("textbox", { name: "Folder name" }),
        "Pictures{Enter}",
      );

      expect(
        await screen.findByText("Something here already has that name"),
      ).toBeVisible();
      expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveValue(
        "Pictures",
      );
      expect(where()).toStrictEqual(["~"]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await answered).toBeUndefined();
    });

    it("makes none without a name", async () => {
      const made: string[] = [];
      const { folders } = foldersOf();
      const answered = picker(ChooserMode.Open, {
        folders: {
          ...folders,
          create: (path) => {
            made.push(path);
            return folders.create(path);
          },
        },
      });
      await rows();
      await userEvent.click(screen.getByRole("button", { name: "New folder" }));

      await userEvent.type(
        screen.getByRole("textbox", { name: "Folder name" }),
        "{Enter}",
      );

      expect(made).toStrictEqual([]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await answered).toBeUndefined();
    });

    it("makes none on Escape, and stays open", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.click(screen.getByRole("button", { name: "New folder" }));
      expect(
        screen.getByRole("textbox", { name: "Folder name" }),
      ).toHaveFocus();

      await userEvent.keyboard("{Escape}");

      expect(
        screen.queryByRole("textbox", { name: "Folder name" }),
      ).not.toBeInTheDocument();
      expect(box()).toHaveFocus();
      expect(await unanswered(answered)).toBe(true);
      await cancel(answered);
    });
  });

  it("takes its title from the request", async () => {
    const answered = picker(ChooserMode.Open, { title: "Attach a photo" });
    await rows();

    expect(
      screen.getByRole("dialog", { name: "Attach a photo" }),
    ).toBeInTheDocument();
    await cancel(answered);
  });

  it("labels its confirm button as the request asks", async () => {
    const answered = picker(ChooserMode.Open, { acceptLabel: "Attach" });
    await rows();

    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
    await cancel(answered);
  });

  it("shows the controls the request adds", async () => {
    const answered = picker(ChooserMode.Open, {
      controls: <button type="button">Read only</button>,
    });
    await rows();

    expect(
      screen.getByRole("button", { name: "Read only" }),
    ).toBeInTheDocument();
    await cancel(answered);
  });

  it.each([
    [ChooserMode.Open, "Open a file"],
    [ChooserMode.OpenMultiple, "Open files"],
    [ChooserMode.OpenFolder, "Choose a folder"],
    [ChooserMode.Save, "Save as"],
  ])("says what it is asking for", async (mode, title) => {
    const answered = picker(mode);
    await rows();

    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    await cancel(answered);
  });
});
