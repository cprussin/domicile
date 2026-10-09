import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClearDataDialog } from "./ClearDataDialog";

const NOW = 1_000_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

type Cleared = {
  since: number;
  dataToRemove: Readonly<Record<string, boolean>>;
};

/** The dialog, open, resolving with what it asked to clear. */
const renderDialog = () => {
  const cleared = new Promise<Cleared>((resolve) => {
    render(
      <ClearDataDialog
        now={() => NOW}
        onCleared={() => undefined}
        onFailed={() => undefined}
        onOpenChange={() => undefined}
        open
        removeBrowsingData={(since, dataToRemove) => {
          resolve({ dataToRemove, since });
          return Promise.resolve();
        }}
      />,
    );
  });
  return { cleared, user: userEvent.setup() };
};

describe(ClearDataDialog, () => {
  it("clears history, site data and the cache from the last hour by default", async () => {
    const { cleared, user } = renderDialog();
    await user.click(await screen.findByRole("button", { name: "Clear data" }));
    expect(await cleared).toEqual({
      dataToRemove: {
        cache: true,
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        history: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      },
      since: NOW - HOUR_MS,
    });
  });

  it("clears what is chosen over the range chosen", async () => {
    const { cleared, user } = renderDialog();
    await user.click(
      await screen.findByRole("switch", { name: "Browsing history" }),
    );
    await user.click(
      screen.getByRole("switch", { name: "Cookies and other site data" }),
    );
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.click(
      await screen.findByRole("switch", { name: "Download history" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Time range" }));
    await user.click(await screen.findByRole("option", { name: "All time" }));
    await user.click(screen.getByRole("button", { name: "Clear data" }));
    expect(await cleared).toEqual({
      dataToRemove: { cache: true, downloads: true },
      since: 0,
    });
  });

  it("can't clear with nothing chosen", async () => {
    const { user } = renderDialog();
    for (const name of [
      "Browsing history",
      "Cookies and other site data",
      "Cached images and files",
    ]) {
      await user.click(await screen.findByRole("switch", { name }));
    }
    expect(screen.getByRole("button", { name: "Clear data" })).toBeDisabled();
  });

  it("reports when the data is cleared", async () => {
    const user = userEvent.setup();
    await new Promise<void>((resolve) => {
      render(
        <ClearDataDialog
          now={() => NOW}
          onCleared={resolve}
          onFailed={() => undefined}
          onOpenChange={() => undefined}
          open
          removeBrowsingData={() => Promise.resolve()}
        />,
      );
      screen
        .findByRole("button", { name: "Clear data" })
        .then((button) => user.click(button))
        .catch(() => undefined);
    });
  });

  it("reports why clearing failed", async () => {
    const user = userEvent.setup();
    const error = await new Promise((resolve) => {
      render(
        <ClearDataDialog
          now={() => NOW}
          onCleared={() => undefined}
          onFailed={resolve}
          onOpenChange={() => undefined}
          open
          removeBrowsingData={() => Promise.reject(new Error("busy"))}
        />,
      );
      screen
        .findByRole("button", { name: "Clear data" })
        .then((button) => user.click(button))
        .catch(() => undefined);
    });
    expect(error).toEqual(new Error("busy"));
  });
});
