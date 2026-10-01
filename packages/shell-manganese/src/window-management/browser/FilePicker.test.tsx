import { describe, expect, it } from "bun:test";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePicker } from "./FilePicker";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";

const HOME = "/home/someone";

/**
 * The filesystem the engine lists, by absolute path. A directory's name ends
 * in `/`, and a path missing here is one the browser cannot read.
 */
const FILESYSTEM = new Map<string, readonly string[]>([
  ["/", ["home/", "tmp/"]],
  ["/home", ["someone/"]],
  [HOME, ["Documents/", "Pictures/", "Scratch/", "notes.txt", ".bashrc"]],
  [`${HOME}/Documents`, ["report.pdf"]],
  [`${HOME}/Pictures`, ["cat.png", "dog.png", "trips/"]],
  [`${HOME}/Pictures/trips`, []],
  [`${HOME}/Scratch`, ["draft.md"]],
  ["/tmp", []],
]);

const list = (path: string): Promise<readonly string[]> => {
  const entries = FILESYSTEM.get(path);
  return entries === undefined
    ? Promise.reject(new DOMException(path, "NotReadableError"))
    : Promise.resolve(entries);
};

/** The answer a picker gave: the paths chosen, or `undefined` for a cancel. */
type Answer = readonly string[] | undefined;

/**
 * A picker up for `mode`, and the answer it gives — which the test awaits
 * after driving it, so a picker that never answers times out.
 */
const picker = (
  mode: ChooserMode,
  { accept = [], suggestedName = "" }: Partial<FileRequest> = {},
): Promise<Answer> =>
  new Promise((resolve) => {
    render(
      <FilePicker
        request={{
          accept,
          cancel: () => {
            resolve(undefined);
          },
          choose: resolve,
          home: HOME,
          list,
          mode,
          suggestedName,
        }}
      />,
    );
  });

const box = (): HTMLElement =>
  screen.getByRole("combobox", { name: "Filter or go to a path" });

/** The rows, once the engine has listed the directory the picker is in. */
const rows = async (): Promise<readonly string[]> => {
  await act(() => Promise.resolve());
  return screen.queryAllByRole("option").map((row) => row.textContent);
};

/** Where the picker is, as its path bar says it. */
const where = (): readonly string[] =>
  within(screen.getByRole("navigation", { name: "Path" }))
    .getAllByRole("button")
    .map((crumb) => crumb.textContent);

const selection = (): HTMLElement =>
  screen.getByRole("status", { name: "Selection" });

const cancel = async (answered: Promise<Answer>) => {
  await userEvent.type(box(), "{Escape}");
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

      await userEvent.click(screen.getByRole("button", { name: "Pictures" }));
      expect(where()).toStrictEqual(["~", "Pictures"]);
      await cancel(answered);
    });

    it("shows what starts with a dot once a dot is typed", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), ".b");

      expect(await rows()).toStrictEqual([".bashrc"]);
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
    it("offers only the files the page will take", async () => {
      const answered = picker(ChooserMode.Open, { accept: ["pdf"] });
      await rows();

      await userEvent.type(box(), "Documents/");

      expect(await rows()).toStrictEqual(["..", "report.pdf"]);
      await cancel(answered);
    });

    it("chooses the file entered", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "notes{Enter}");

      expect(await answered).toStrictEqual([`${HOME}/notes.txt`]);
    });

    // A click picks a file out, and says which; it does not answer for it.
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

  // fzf's keys: Tab marks a file and moves on, and Enter takes every mark —
  // wherever in the tree each was made.
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
    it("saves the name suggested in the folder it is in", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();
      await userEvent.type(box(), "Pictures/");

      expect(selection()).toHaveTextContent("~/Pictures/photo.png");
      await userEvent.type(
        screen.getByRole("textbox", { name: "Name" }),
        "{Enter}",
      );
      expect(await answered).toStrictEqual([`${HOME}/Pictures/photo.png`]);
    });

    it("takes the name of a file that is clicked", async () => {
      const answered = picker(ChooserMode.Save, { suggestedName: "photo.png" });
      await rows();

      await userEvent.click(screen.getByRole("option", { name: "notes.txt" }));

      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
        "notes.txt",
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await answered).toStrictEqual([`${HOME}/notes.txt`]);
    });

    it("saves nothing without a name", async () => {
      const answered = picker(ChooserMode.Save);
      await rows();

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await answered).toBeUndefined();
    });
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
