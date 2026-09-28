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
