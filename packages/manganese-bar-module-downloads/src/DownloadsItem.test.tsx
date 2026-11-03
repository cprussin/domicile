import { describe, expect, it, jest } from "bun:test";
import type { Download } from "@domicile-desktop/sdk/desktop/downloads";
import { DownloadState } from "@domicile-desktop/sdk/desktop/downloads";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { DownloadsItem, OpenResult } from "./DownloadsItem";
import { DONE_MS, FULL_MS } from "./useFinish";

const download = (fields: Partial<Download> & { id: string }): Download => ({
  page: "https://mail.google.com/mail/u/0/",
  path: `/home/me/Downloads/${fields.id}`,
  receivedBytes: 100,
  state: DownloadState.Complete,
  totalBytes: 100,
  window: "1",
  ...fields,
});

const INVOICE = download({ id: "invoice.pdf" });
const PHOTOS = download({
  id: "photos.zip",
  page: "https://www.example.com/gallery",
  receivedBytes: 4_200_000,
  state: DownloadState.InProgress,
  totalBytes: 18_000_000,
});
const BROKEN = download({ id: "broken.iso", state: DownloadState.Failed });

type Calls = {
  onCancel: (id: string) => void;
  onClear: () => void;
  onOpen: (path: string) => Promise<OpenResult>;
  onRemove: (id: string) => void;
  onShowInFolder: (path: string) => void;
};

const IGNORE = () => undefined;

const OPENED = () => Promise.resolve(OpenResult.Opened);

const itemOf = (
  downloads: readonly Download[] | undefined,
  calls: Partial<Calls>,
  popsUp: boolean,
) => (
  <DownloadsItem
    downloads={downloads}
    onCancel={calls.onCancel ?? IGNORE}
    onClear={calls.onClear ?? IGNORE}
    onOpen={calls.onOpen ?? OPENED}
    onRemove={calls.onRemove ?? IGNORE}
    onShowInFolder={calls.onShowInFolder ?? IGNORE}
    popsUp={popsUp}
  />
);

const item = (
  downloads: readonly Download[] | undefined,
  calls: Partial<Calls> = {},
  popsUp = false,
) => {
  const rendered = render(itemOf(downloads, calls, popsUp));
  return {
    /** The desk's downloads are now `next`. */
    now: (next: readonly Download[] | undefined) => {
      rendered.rerender(itemOf(next, calls, popsUp));
    },
  };
};

const open = async (name = "Downloads") => {
  await userEvent.click(screen.getByRole("button", { name }));
};

/** The panel's row for the file `name`. */
const row = (name: string) => {
  const found = screen
    .getAllByRole("listitem")
    .find((listed) => within(listed).queryByText(name) !== null);
  if (found === undefined) {
    throw new Error(`No row for ${name}`);
  }
  return within(found);
};

describe("DownloadsItem", () => {
  describe("the bar item", () => {
    it("is hidden until the engine lists the downloads", () => {
      item(undefined);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("is hidden while there are no downloads", () => {
      item([]);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("says how far the downloads in progress have come", () => {
      item([INVOICE, PHOTOS, { ...PHOTOS, id: "b", receivedBytes: 0 }]);
      expect(
        screen.getByRole("button", { name: "Downloading 2 files, 11%" }),
      ).toHaveTextContent("11%");
    });

    it("keeps no room for the percent while it shows none", () => {
      // The column the words open into closes to nothing, so the space
      // between them and the icon must close with them.
      item([INVOICE]);
      const words = screen
        .getByRole("button")
        .querySelectorAll("span span span");

      expect(
        [...words].map((word) =>
          word.className.includes(css({ paddingInlineStart: 1 })),
        ),
      ).toEqual([true, true]);
    });

    it("claims no amount while a size is unknown", () => {
      item([{ ...PHOTOS, totalBytes: 0 }]);
      expect(
        screen.getByRole("button", { name: "Downloading 1 file" }),
      ).not.toHaveTextContent("%");
    });
  });

  describe("the panel", () => {
    it("hangs from the item's end, which stays put as the item resizes", async () => {
      item([PHOTOS]);
      await open("Downloading 1 file, 23%");

      expect(
        screen.getByRole("dialog").closest("[data-align]"),
      ).toHaveAttribute("data-align", "end");
    });

    it("lists each download, the newest first", async () => {
      item([INVOICE, PHOTOS, BROKEN]);
      await open("Downloading 1 file, 23%");

      expect(
        screen.getAllByRole("listitem").map((listed) => listed.textContent),
      ).toStrictEqual([
        expect.stringContaining("broken.iso"),
        expect.stringContaining("photos.zip"),
        expect.stringContaining("invoice.pdf"),
      ]);
    });

    it("says where each came from and how it is going", async () => {
      item([INVOICE, PHOTOS, BROKEN]);
      await open("Downloading 1 file, 23%");

      expect(
        row("invoice.pdf").getByText("From mail.google.com"),
      ).toBeVisible();
      expect(row("photos.zip").getByText("4.2 of 18 MB")).toBeVisible();
      expect(
        row("photos.zip").getByRole("progressbar", { name: "photos.zip" }),
      ).toHaveAttribute("aria-valuenow", "23");
      expect(
        row("broken.iso").getByText("Failed · From mail.google.com"),
      ).toBeVisible();
    });

    it("cancels a download in progress", async () => {
      const canceled = new Promise((resolve) => {
        item([PHOTOS], { onCancel: resolve });
      });
      await open("Downloading 1 file, 23%");
      await userEvent.click(
        row("photos.zip").getByRole("button", { name: "Cancel" }),
      );

      expect(await canceled).toBe(PHOTOS.id);
    });

    it("opens a finished file", async () => {
      const opened = new Promise((resolve) => {
        item([INVOICE], {
          onOpen: (path) => {
            resolve(path);
            return Promise.resolve(OpenResult.Opened);
          },
        });
      });
      await open();
      await userEvent.click(
        row("invoice.pdf").getByRole("button", { name: "Open" }),
      );

      expect(await opened).toBe(INVOICE.path);
    });

    it("shows a finished file in its folder", async () => {
      const shown = new Promise((resolve) => {
        item([INVOICE], { onShowInFolder: resolve });
      });
      await open();
      await userEvent.click(
        row("invoice.pdf").getByRole("button", { name: "Show in folder" }),
      );

      expect(await shown).toBe(INVOICE.path);
    });

    it("removes a failed download from the list", async () => {
      const removed = new Promise((resolve) => {
        item([BROKEN], { onRemove: resolve });
      });
      await open();
      await userEvent.click(
        row("broken.iso").getByRole("button", { name: "Remove from list" }),
      );

      expect(await removed).toBe(BROKEN.id);
    });

    it("clears every download not in progress", async () => {
      const cleared = new Promise((resolve) => {
        item([INVOICE], { onClear: () => resolve(undefined) });
      });
      await open();
      await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

      expect(await cleared).toBeUndefined();
    });

    it("offers no clearing while every download is in progress", async () => {
      item([PHOTOS]);
      await open("Downloading 1 file, 23%");

      expect(
        screen.queryByRole("button", { name: "Clear all" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("opening by itself", () => {
    it("opens when a download starts, on the screen it pops up on", async () => {
      const { now } = item([INVOICE], {}, true);
      now([INVOICE, PHOTOS]);

      expect(
        await screen.findByRole("heading", { name: "Downloads" }),
      ).toBeInTheDocument();
      expect(row("photos.zip").getByText("4.2 of 18 MB")).toBeInTheDocument();
    });

    it("stays shut on another screen", () => {
      const { now } = item([INVOICE], {}, false);
      now([INVOICE, PHOTOS]);

      expect(screen.queryByRole("heading", { name: "Downloads" })).toBeNull();
    });

    it("stays shut for the downloads already there", () => {
      const { now } = item(undefined, {}, true);
      now([PHOTOS]);

      expect(screen.queryByRole("heading", { name: "Downloads" })).toBeNull();
    });

    it("stays shut when a download only finishes", () => {
      const { now } = item([PHOTOS], {}, true);
      now([
        { ...PHOTOS, receivedBytes: 18_000_000, state: DownloadState.Complete },
      ]);

      expect(screen.queryByRole("heading", { name: "Downloads" })).toBeNull();
    });
  });

  describe("rows leaving", () => {
    it("keeps a removed row while it slides out", async () => {
      const { now } = item([INVOICE, BROKEN]);
      await open();
      now([INVOICE]);

      expect(document.querySelector("li[data-leaving]")).toHaveTextContent(
        "broken.iso",
      );
    });
  });

  describe("a file nothing opens", () => {
    it("says no app can open it", async () => {
      item([INVOICE], { onOpen: () => Promise.resolve(OpenResult.NoApp) });
      await open();
      await userEvent.click(
        row("invoice.pdf").getByRole("button", { name: "Open" }),
      );

      expect(
        await screen.findByText("No app on this computer can open .pdf files."),
      ).toBeVisible();
    });

    it("says so of a file with no extension", async () => {
      const notes = download({ id: "NOTES" });
      item([notes], { onOpen: () => Promise.resolve(OpenResult.NoApp) });
      await open();
      await userEvent.click(row("NOTES").getByRole("button", { name: "Open" }));

      expect(
        await screen.findByText("No app on this computer can open this file."),
      ).toBeVisible();
    });
  });

  describe("finishing", () => {
    it("fills, says done, then rests", () => {
      jest.useFakeTimers();
      const { now } = item([PHOTOS]);
      now([
        { ...PHOTOS, receivedBytes: 18_000_000, state: DownloadState.Complete },
      ]);
      expect(screen.getByRole("button")).toHaveTextContent("100%");

      act(() => {
        jest.advanceTimersByTime(FULL_MS);
      });
      expect(
        screen.getByRole("button", { name: "Downloads finished" }),
      ).toHaveTextContent("Done");

      act(() => {
        jest.advanceTimersByTime(DONE_MS);
      });
      expect(screen.getByRole("button", { name: "Downloads" })).toBeVisible();
      jest.useRealTimers();
    });
  });
});
