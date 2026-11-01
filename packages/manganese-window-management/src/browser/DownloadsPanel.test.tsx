import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DownloadsPanel } from "./DownloadsPanel";

const IGNORE = () => undefined;

const panel = (
  paths: readonly string[] | undefined,
  calls: Partial<{
    onClearAll: () => void;
    onOpen: (path: string) => void;
    onRemove: (path: string) => void;
    onShowInFolder: (path: string) => void;
  }> = {},
) =>
  render(
    <DownloadsPanel
      count={paths?.length ?? 2}
      onClearAll={calls.onClearAll ?? IGNORE}
      onOpen={calls.onOpen ?? IGNORE}
      onRemove={calls.onRemove ?? IGNORE}
      onShowInFolder={calls.onShowInFolder ?? IGNORE}
      paths={paths}
    />,
  );

describe(DownloadsPanel, () => {
  describe("rendering", () => {
    it("says one download finished", () => {
      panel(["/home/me/Downloads/report.pdf"]);
      expect(
        screen.getByRole("heading", { name: "Download finished" }),
      ).toBeInTheDocument();
    });

    it("says how many finished", () => {
      panel(["/home/me/Downloads/a.jpg", "/home/me/Pictures/b.jpg"]);
      expect(
        screen.getByRole("heading", { name: "2 downloads finished" }),
      ).toBeInTheDocument();
    });

    it("lists each file by name and folder, the newest first", () => {
      panel(["/home/me/Downloads/a.jpg", "/home/me/Pictures/b.jpg"]);
      const rows = screen.getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toStrictEqual([
        expect.stringContaining("b.jpgSaved to Pictures"),
        expect.stringContaining("a.jpgSaved to Downloads"),
      ]);
    });

    it("lists no files from an engine that does not say where they went", () => {
      panel(undefined);
      expect(
        screen.getByRole("heading", { name: "2 downloads finished" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("list")).toBeNull();
    });
  });

  describe("interactions", () => {
    const pressIn = async (name: string, button: string) => {
      const row = screen
        .getAllByRole("listitem")
        .find((item) => item.textContent?.includes(name));
      if (row === undefined) {
        throw new Error(`no row for ${name}`);
      }
      await userEvent.click(within(row).getByRole("button", { name: button }));
    };

    it("opens a file", async () => {
      const opened = new Promise((resolve) => {
        panel(["/home/me/Downloads/a.jpg", "/home/me/Downloads/b.jpg"], {
          onOpen: resolve,
        });
      });
      await pressIn("a.jpg", "Open");
      expect(await opened).toBe("/home/me/Downloads/a.jpg");
    });

    it("shows a file in its folder", async () => {
      const shown = new Promise((resolve) => {
        panel(["/home/me/Downloads/a.jpg"], { onShowInFolder: resolve });
      });
      await pressIn("a.jpg", "Show in folder");
      expect(await shown).toBe("/home/me/Downloads/a.jpg");
    });

    it("removes a file from the list", async () => {
      const removed = new Promise((resolve) => {
        panel(["/home/me/Downloads/a.jpg"], { onRemove: resolve });
      });
      await pressIn("a.jpg", "Remove from list");
      expect(await removed).toBe("/home/me/Downloads/a.jpg");
    });

    it("clears them all", async () => {
      const cleared = new Promise((resolve) => {
        panel(["/home/me/Downloads/a.jpg"], {
          onClearAll: () => {
            resolve(true);
          },
        });
      });
      await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
      expect(await cleared).toBe(true);
    });
  });
});
