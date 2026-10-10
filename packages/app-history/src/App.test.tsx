import { describe, expect, it } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import type { Browser } from "./browser";
import type { FakePage } from "./fake-history";
import { fakeBrowser } from "./fake-history";

const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).getTime();
const NOW = () => at(9, 15, 42);

const HISTORY: FakePage[] = [
  { title: "Cats", url: "https://www.cats.test/", visits: [at(9, 14, 5)] },
  { title: "", url: "https://untitled.test/page", visits: [at(9, 13, 0)] },
  { title: "Dogs", url: "https://dogs.test/", visits: [at(8, 9, 30)] },
  { title: "Birds", url: "https://birds.test/", visits: [at(6, 8, 0)] },
];

/** The app over a copy of `pages`, with `overrides` on its browser. */
const renderApp = (
  pages: FakePage[] = HISTORY,
  overrides: Partial<Browser> = {},
) => {
  const history = pages.map((page) => ({ ...page, visits: [...page.visits] }));
  const { browser } = fakeBrowser(history);
  render(<App browser={{ ...browser, ...overrides }} now={NOW} />);
  return { history, user: userEvent.setup() };
};

/** Ends the leaving animation of each row removed, once there are some. */
const finishLeaving = async () => {
  const rows = await waitFor(() => {
    const leaving = document.querySelectorAll("li[data-leaving]");
    expect(leaving.length).toBeGreaterThan(0);
    return leaving;
  });
  for (const leaving of rows) {
    fireEvent.animationEnd(leaving);
  }
};

const row = (name: string) =>
  screen.getByRole("link", { name: new RegExp(name) }).closest("li") ??
  document.body;

describe(App, () => {
  describe("rendering", () => {
    it("lists visits under their days", async () => {
      renderApp();
      const today = await screen.findByRole("region", {
        name: "Today - Friday, October 9, 2026",
      });
      expect(
        within(today)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "2:05 PMCatscats.test",
        "1:00 PMhttps://untitled.test/pageuntitled.test",
      ]);
      expect(
        screen.getByRole("region", {
          name: "Yesterday - Thursday, October 8, 2026",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tuesday, October 6, 2026" }),
      ).toBeInTheDocument();
    });

    it("links each row to its page", async () => {
      renderApp();
      expect(await screen.findByRole("link", { name: /Cats/ })).toHaveAttribute(
        "href",
        "https://www.cats.test/",
      );
    });

    it("says when the history is empty", async () => {
      renderApp([]);
      expect(
        await screen.findByRole("heading", { name: "Your history is empty" }),
      ).toBeInTheDocument();
    });

    it("says when loading fails", async () => {
      renderApp(HISTORY, {
        search: () => Promise.reject(new Error("no history service")),
      });
      expect(
        await screen.findByRole("heading", {
          name: "Couldn't load your history",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("no history service")).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("lists only matching pages", async () => {
      const { user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.type(
        screen.getByRole("searchbox", { name: "Search history" }),
        "Dogs",
      );
      await waitForElementToBeRemoved(() =>
        screen.queryByRole("link", { name: /Cats/ }),
      );
      expect(screen.getByRole("link", { name: /Dogs/ })).toBeInTheDocument();
    });

    it("says when nothing matches", async () => {
      const { user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.type(
        screen.getByRole("searchbox", { name: "Search history" }),
        "zebras",
      );
      expect(
        await screen.findByRole("heading", { name: "No search results found" }),
      ).toBeInTheDocument();
    });

    it("focuses on / and clears on Escape", async () => {
      const { user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.keyboard("/");
      const box = screen.getByRole("searchbox", { name: "Search history" });
      expect(box).toHaveFocus();
      await user.keyboard("cats{Escape}");
      expect(box).toHaveValue("");
    });
  });

  describe("selection", () => {
    it("selects rows, a range with Shift, and deletes them after asking", async () => {
      const { history, user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.click(screen.getByRole("checkbox", { name: "Select Cats" }));
      expect(
        screen.getByRole("toolbar", { name: "Selection" }),
      ).toHaveTextContent(/^1 selected/);
      await user.keyboard("{Shift>}");
      await user.click(screen.getByRole("checkbox", { name: "Select Dogs" }));
      await user.keyboard("{/Shift}");
      expect(
        screen.getByRole("toolbar", { name: "Selection" }),
      ).toHaveTextContent(/^3 selected/);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Remove selected items?",
      });
      await user.click(within(dialog).getByRole("button", { name: "Remove" }));
      await finishLeaving();
      expect(
        screen.getAllByRole("link").map((link) => link.textContent),
      ).toEqual(["Birdsbirds.test"]);
      expect(history.map((page) => page.visits.length)).toEqual([0, 0, 0, 1]);
    });

    it("clears the selection on Cancel", async () => {
      const { user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.click(screen.getByRole("checkbox", { name: "Select Cats" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.getByRole("checkbox", { name: "Select Cats" }),
      ).not.toBeChecked();
    });
  });

  describe("keyboard", () => {
    it("moves between rows and selects with Space", async () => {
      const { user } = renderApp();
      const cats = await screen.findByRole("link", { name: /Cats/ });
      cats.focus();
      await user.keyboard("{ArrowDown}");
      expect(
        screen.getByRole("link", { name: /untitled\.test\/page/ }),
      ).toHaveFocus();
      await user.keyboard("k");
      expect(cats).toHaveFocus();
      await user.keyboard(" ");
      expect(
        screen.getByRole("checkbox", { name: "Select Cats" }),
      ).toBeChecked();
    });
  });

  describe("row actions", () => {
    it("removes a row from its menu", async () => {
      const { history, user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.click(
        within(row("Cats")).getByRole("button", { name: "Actions for Cats" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Remove from history" }),
      );
      await finishLeaving();
      expect(
        screen.queryByRole("link", { name: /Cats/ }),
      ).not.toBeInTheDocument();
      expect(history[0]?.visits).toEqual([]);
    });

    it("tells when a removal fails", async () => {
      const { user } = renderApp(HISTORY, {
        deleteVisits: () => Promise.reject(new Error("history is locked")),
      });
      await user.click(
        await screen.findByRole("button", { name: "Actions for Cats" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Remove from history" }),
      );
      expect(
        await screen.findByText("Couldn't update your history"),
      ).toBeInTheDocument();
      expect(screen.getByText("history is locked")).toBeInTheDocument();
    });

    it("tells of a failed removal once", async () => {
      const calls = { count: 0 };
      const { user } = renderApp(HISTORY, {
        deleteVisits: () => {
          calls.count += 1;
          return calls.count === 1
            ? Promise.reject(new Error("history is locked"))
            : Promise.resolve();
        },
      });
      for (const name of ["Cats", "Dogs"]) {
        await user.click(
          await screen.findByRole("button", { name: `Actions for ${name}` }),
        );
        await user.click(
          await screen.findByRole("menuitem", { name: "Remove from history" }),
        );
      }
      await finishLeaving();
      await screen.findAllByText("Couldn't update your history");
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(screen.getAllByText("Couldn't update your history")).toHaveLength(
        1,
      );
    });

    it("keeps scrolling after a removal fails", async () => {
      const many: FakePage[] = Array.from({ length: 160 }, (_, index) => ({
        title: `Page ${index}`,
        url: `https://${index}.test/`,
        visits: [at(9, 14, 0) - index * 60_000],
      }));
      const { user } = renderApp(many, {
        deleteVisits: () => Promise.reject(new Error("history is locked")),
      });
      await user.click(
        await screen.findByRole("button", { name: "Actions for Page 0" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Remove from history" }),
      );
      await screen.findByText("history is locked");
      expect(
        screen.queryByRole("button", { name: "Try again" }),
      ).not.toBeInTheDocument();
    });

    it("searches the row's site", async () => {
      const { user } = renderApp();
      await screen.findByRole("link", { name: /Cats/ });
      await user.click(
        within(row("Dogs")).getByRole("button", { name: "Actions for Dogs" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "More from this site" }),
      );
      expect(
        screen.getByRole("searchbox", { name: "Search history" }),
      ).toHaveValue("dogs.test");
    });

    it("opens a row in a new window from its context menu", async () => {
      const opened = new Promise((resolve) => {
        const { user } = renderApp(HISTORY, {
          openInNewWindow: (url) => {
            resolve(url);
            return Promise.resolve();
          },
        });
        screen
          .findByRole("link", { name: /Dogs/ })
          .then(async (link) => {
            await user.pointer({ keys: "[MouseRight]", target: link });
            await user.click(
              await screen.findByRole("menuitem", {
                name: "Open in new window",
              }),
            );
          })
          .catch(() => undefined);
      });
      expect(await opened).toBe("https://dogs.test/");
    });

    it("opens a row in a new window on Ctrl+click", async () => {
      const opened = new Promise((resolve) => {
        const { user } = renderApp(HISTORY, {
          openInNewWindow: (url) => {
            resolve(url);
            return Promise.resolve();
          },
        });
        screen
          .findByRole("link", { name: /Dogs/ })
          .then(async (link) => {
            await user.keyboard("{Control>}");
            await user.click(link);
          })
          .catch(() => undefined);
      });
      expect(await opened).toBe("https://dogs.test/");
    });

    it("copies a row's link", async () => {
      const copied = new Promise((resolve) => {
        const { user } = renderApp(HISTORY, {
          copyText: (text) => {
            resolve(text);
            return Promise.resolve();
          },
        });
        screen
          .findByRole("button", { name: "Actions for Birds" })
          .then(async (button) => {
            await user.click(button);
            await user.click(
              await screen.findByRole("menuitem", { name: "Copy link" }),
            );
          })
          .catch(() => undefined);
      });
      expect(await copied).toBe("https://birds.test/");
      expect(await screen.findByText("Link copied")).toBeInTheDocument();
    });
  });

  it("opens the dialog to clear browsing data", async () => {
    const { user } = renderApp();
    await user.click(
      screen.getByRole("button", { name: "Clear browsing data" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Clear browsing data" }),
    ).toBeInTheDocument();
  });
});
