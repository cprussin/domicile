import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePicker } from "./FilePicker";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";

/** A home the host searches, in its own vocabulary: a directory ends in `/`. */
const HOME_FILES = [
  "Documents/",
  "Documents/report.pdf",
  "Pictures/",
  "Pictures/cat.png",
  "Pictures/dog.png",
  "notes.txt",
];

/** The host's search over that home: every word, any order, any case. */
const search = (query: string) => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const files = HOME_FILES.filter((path) =>
    words.every((word) => path.toLowerCase().includes(word)),
  );
  return Promise.resolve({
    files,
    indexing: false,
    matched: files.length,
    query,
  });
};

/**
 * The filesystem the engine lists, by the path the picker asks for: absolute,
 * or relative to home. A directory's name ends in `/`, and a path missing here
 * is one the browser cannot read.
 */
const FILESYSTEM = new Map<string, readonly string[]>([
  ["", ["Documents/", "Pictures/", "notes.txt"]],
  ["Pictures", ["cat.png", "dog.png"]],
  ["/", ["mnt/", "tmp/"]],
  ["/mnt", ["usb/"]],
  ["/mnt/usb", ["photo.png", "raw/"]],
  ["/mnt/usb/raw", []],
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
          list,
          mode,
          suggestedName,
        }}
        search={search}
      />,
    );
  });

const box = (): HTMLElement =>
  screen.getByRole("combobox", { name: "Search your files" });

/**
 * The rows, once the host has answered — which is after the picker is up, and
 * after the one row that needs no answer: home, for a save.
 */
const rows = async (): Promise<readonly string[]> => {
  await act(() => Promise.resolve());
  return screen.getAllByRole("option").map((row) => row.textContent);
};

describe("FilePicker", () => {
  describe("opening a file", () => {
    it("offers the files the page will take, and no directories", async () => {
      const answered = picker(ChooserMode.Open, { accept: ["png"] });

      expect(await rows()).toStrictEqual([
        "Picturescat.png",
        "Picturesdog.png",
      ]);
      await userEvent.type(box(), "{Escape}");
      await answered;
    });

    it("chooses the highlighted row with Enter", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "{ArrowDown}{Enter}");

      expect(await answered).toStrictEqual(["Pictures/cat.png"]);
    });

    it("chooses a row that is clicked", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.click(screen.getByRole("option", { name: /dog\.png/ }));

      expect(await answered).toStrictEqual(["Pictures/dog.png"]);
    });

    it("narrows the rows to what is typed", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "notes");

      expect(await rows()).toStrictEqual(["notes.txt"]);
      await userEvent.type(box(), "{Enter}");
      expect(await answered).toStrictEqual(["notes.txt"]);
    });
  });

  // fzf's keys, which is what the launcher is modeled on: Tab marks a row and
  // moves on, and Enter takes everything marked.
  describe("opening several files", () => {
    it("chooses every row marked with Tab", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();

      await userEvent.type(box(), "{Tab}{ArrowDown}{Tab}{Enter}");

      expect(await answered).toStrictEqual([
        "Documents/report.pdf",
        "Pictures/dog.png",
      ]);
    });

    it("marks a row that is clicked, and unmarks it clicked again", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();

      await userEvent.click(screen.getByRole("option", { name: /cat\.png/ }));
      await userEvent.click(screen.getByRole("option", { name: /notes/ }));
      await userEvent.click(screen.getByRole("option", { name: /cat\.png/ }));

      expect(
        screen.getByRole("option", { name: /notes/, selected: true }),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(await answered).toStrictEqual(["notes.txt"]);
    });

    it("chooses the highlighted row when nothing is marked", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();

      await userEvent.type(box(), "{Enter}");

      expect(await answered).toStrictEqual(["Documents/report.pdf"]);
    });
  });

  describe("opening a folder", () => {
    it("offers directories, and chooses one without its slash", async () => {
      const answered = picker(ChooserMode.OpenFolder);

      expect(await rows()).toStrictEqual(["Documents", "Pictures"]);
      await userEvent.type(box(), "{ArrowDown}{Enter}");
      expect(await answered).toStrictEqual(["Pictures"]);
    });
  });

  describe("saving", () => {
    it("saves under the name the page suggested, in home to begin with", async () => {
      const answered = picker(ChooserMode.Save, {
        suggestedName: "photo.png",
      });

      expect(await rows()).toStrictEqual(["Home", "Documents", "Pictures"]);
      await userEvent.type(box(), "{Enter}");
      expect(await answered).toStrictEqual(["photo.png"]);
    });

    it("saves in the directory highlighted, under the name typed", async () => {
      const answered = picker(ChooserMode.Save, {
        suggestedName: "photo.png",
      });
      await rows();
      const name = screen.getByRole("textbox", { name: "Name" });
      await userEvent.clear(name);
      await userEvent.type(name, "cat.jpg");

      await userEvent.type(box(), "{ArrowDown}{ArrowDown}");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await answered).toStrictEqual(["Pictures/cat.jpg"]);
    });

    // A click on a directory is half of a save, and the keyboard stays in
    // the field that was being typed in.
    it("saves in a directory that is clicked, leaving the keyboard where it was", async () => {
      const answered = picker(ChooserMode.Save, {
        suggestedName: "photo.png",
      });
      await rows();
      await userEvent.click(box());

      await userEvent.click(screen.getByRole("option", { name: "Documents" }));

      expect(box()).toHaveFocus();
      await userEvent.type(box(), "{Enter}");
      expect(await answered).toStrictEqual(["Documents/photo.png"]);
    });

    it("saves nothing without a name", async () => {
      const answered = picker(ChooserMode.Save);
      await rows();

      await userEvent.type(box(), "{Enter}");

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await answered).toBeUndefined();
    });
  });

  // The index is the home, and a file anywhere else is reached by typing
  // where it is.
  describe("walking the filesystem", () => {
    it("lists a directory typed as a path, and walks into one with Enter", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "/mnt/");
      expect(await rows()).toStrictEqual(["usb"]);
      await userEvent.type(box(), "{Enter}");

      expect(box()).toHaveValue("/mnt/usb/");
      expect(await rows()).toStrictEqual(["raw", "photo.png"]);
      await userEvent.type(box(), "{ArrowDown}{Enter}");
      expect(await answered).toStrictEqual(["/mnt/usb/photo.png"]);
    });

    it("walks into a directory that is clicked", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();
      await userEvent.type(box(), "/mnt/");
      await rows();

      await userEvent.click(screen.getByRole("option", { name: "usb" }));

      expect(box()).toHaveValue("/mnt/usb/");
      await userEvent.type(box(), "{Escape}");
      await answered;
    });

    // A directory is somewhere to walk, not a file to take.
    it("marks no directory with Tab", async () => {
      const answered = picker(ChooserMode.OpenMultiple);
      await rows();
      await userEvent.type(box(), "/mnt/usb/");
      await rows();

      await userEvent.type(box(), "{Tab}{Tab}{Enter}");

      expect(await answered).toStrictEqual(["/mnt/usb/photo.png"]);
    });

    it("narrows a listing to what is typed after the last slash", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "/mnt/usb/pho");

      expect(await rows()).toStrictEqual(["photo.png"]);
      await userEvent.type(box(), "{Escape}");
      await answered;
    });

    it("lists home under a tilde, and answers relative to it", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "~/Pictures/{Enter}");

      expect(await answered).toStrictEqual(["Pictures/cat.png"]);
    });

    it("walks into a directory with the right arrow, and up with Backspace", async () => {
      const answered = picker(ChooserMode.OpenFolder);
      await rows();

      await userEvent.type(box(), "/mnt/");
      expect(await rows()).toStrictEqual(["/mnt", "usb"]);
      await userEvent.type(box(), "{ArrowDown}{ArrowRight}");
      expect(box()).toHaveValue("/mnt/usb/");
      await userEvent.type(box(), "{Backspace}");
      expect(box()).toHaveValue("/mnt/");

      await userEvent.type(box(), "{Enter}");
      expect(await answered).toStrictEqual(["/mnt"]);
    });

    // A search finds a directory in the home; the right arrow lists it.
    it("walks into a directory a search found", async () => {
      const answered = picker(ChooserMode.OpenFolder);
      await rows();

      await userEvent.type(box(), "pict{ArrowRight}");

      expect(box()).toHaveValue("~/Pictures/");
      expect(await rows()).toStrictEqual(["~/Pictures"]);
      await userEvent.type(box(), "{Escape}");
      await answered;
    });

    it("saves in a directory typed as a path", async () => {
      const answered = picker(ChooserMode.Save, {
        suggestedName: "photo.png",
      });
      await rows();

      await userEvent.type(box(), "/tmp/{Enter}");

      expect(await answered).toStrictEqual(["/tmp/photo.png"]);
    });

    it("says so when a directory cannot be read", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "/root/");

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Can't read /root/",
      );
      await userEvent.type(box(), "{Escape}");
      await answered;
    });
  });

  describe("canceling", () => {
    it("cancels with Escape", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

      await userEvent.type(box(), "{Escape}");

      expect(await answered).toBeUndefined();
    });

    it("cancels with its button", async () => {
      const answered = picker(ChooserMode.Open);
      await rows();

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
    await userEvent.type(box(), "{Escape}");
    await answered;
  });
});
