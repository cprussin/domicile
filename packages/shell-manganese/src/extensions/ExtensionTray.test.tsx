import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import { WEBVIEW_CLOSE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExtensionTray } from "./ExtensionTray";

const BLOCKER = "abcdefghijklmnopabcdefghijklmnop";
const COUNTER = "ponmlkjihgfedcbaponmlkjihgfedcba";
const POPUP = `chrome-extension://${BLOCKER}/popup.html`;

/** An extension whose click opens its popup. */
const blocker: Extension = {
  badgeColor: "#00000000",
  badgeText: "",
  enabled: true,
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id: BLOCKER,
  name: "Blocker",
  popup: POPUP,
  title: "Blocker: on for this site",
};

/** And one whose click is `action.onClicked`, with a badge set. */
const counter: Extension = {
  badgeColor: "#d93025ff",
  badgeText: "12",
  enabled: true,
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id: COUNTER,
  name: "Counter",
  popup: undefined,
  title: "Counter",
};

/** A client that keeps every extension the tray activated, in order. */
const recordingDomicile = (activated: string[]): DomicileClient =>
  ({
    activateExtension: (id: string) => {
      activated.push(id);
    },
  }) as unknown as DomicileClient;

const NO_DOMICILE = recordingDomicile([]);

/**
 * The popup's view, which is portaled out of the tray to the body, once the
 * popover has placed it — base-ui positions it a tick after it mounts.
 */
const popupView = (): Promise<HTMLWebViewElement> =>
  waitFor(() => {
    const view = document.querySelector("webview");
    if (view === null) {
      throw new Error("test: the popup rendered no view");
    } else {
      return view;
    }
  });

/**
 * The tray with `opened` open, resolving with what it next asks `opened` to
 * become.
 */
const trayAsking = (
  extensions: readonly Extension[],
  opened: string | undefined,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    render(
      <ExtensionTray
        domicile={NO_DOMICILE}
        extensions={extensions}
        onOpen={resolve}
        opened={opened}
      />,
    );
  });

describe("ExtensionTray", () => {
  describe("rendering", () => {
    it("shows each enabled extension's icon, named by its title", () => {
      // A disabled action is left out rather than drawn dimmed.
      const off = {
        ...counter,
        enabled: false,
        id: "x".repeat(32),
        title: "Off",
      };
      render(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[blocker, counter, off]}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toStrictEqual(["Blocker: on for this site", "Counter"]);
      expect(
        screen
          .getByRole("button", { name: "Counter" })
          .querySelector("img")
          ?.getAttribute("src"),
      ).toBe(counter.icon);
    });

    it("draws a badge in its color, and none without text", () => {
      render(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[blocker, counter]}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      expect(screen.getByText("12").style.backgroundColor).toBe("#d93025ff");
      expect(
        screen.getByRole("button", { name: "Blocker: on for this site" })
          .textContent,
      ).toBe("");
    });

    it("holds the popup in a view while it is open, and nothing while not", async () => {
      const { rerender } = render(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[blocker]}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      expect(document.querySelector("webview")).toBeNull();

      rerender(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[blocker]}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );

      expect((await popupView()).getAttribute("src")).toBe(POPUP);
    });

    it("follows the list as it changes", () => {
      const { rerender } = render(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[blocker]}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      rerender(
        <ExtensionTray
          domicile={NO_DOMICILE}
          extensions={[{ ...counter, badgeText: "13" }]}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "Blocker: on for this site" }),
      ).toBeNull();
      expect(screen.getByText("13")).toBeInTheDocument();
    });
  });

  describe("a click", () => {
    it("opens the popup of an extension that has one", async () => {
      const asked = trayAsking([blocker], undefined);

      await userEvent.click(
        screen.getByRole("button", { name: "Blocker: on for this site" }),
      );

      expect(await asked).toBe(BLOCKER);
    });

    it("activates an extension that has none, and opens nothing", async () => {
      const activated: string[] = [];
      const opened: (string | undefined)[] = [];
      render(
        <ExtensionTray
          domicile={recordingDomicile(activated)}
          extensions={[counter]}
          onOpen={(id) => {
            opened.push(id);
          }}
          opened={undefined}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Counter" }));

      expect(activated).toStrictEqual([COUNTER]);
      expect(opened).toStrictEqual([]);
    });
  });

  describe("closing the popup", () => {
    it("closes when the popup closes itself", async () => {
      const asked = trayAsking([blocker], BLOCKER);

      fireEvent(
        await popupView(),
        new Event(WEBVIEW_CLOSE_EVENT, { bubbles: true }),
      );

      expect(await asked).toBeUndefined();
    });

    it("closes on Escape", async () => {
      const asked = trayAsking([blocker], BLOCKER);

      await userEvent.keyboard("{Escape}");

      expect(await asked).toBeUndefined();
    });

    it("closes on a press outside it", async () => {
      const asked = trayAsking([blocker], BLOCKER);

      await userEvent.click(document.body);

      expect(await asked).toBeUndefined();
    });
  });
});
