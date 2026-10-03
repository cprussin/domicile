import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { Extension } from "@domicile/sdk/extension";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_CONTENT_SIZE_CHANGE_EVENT,
} from "@domicile/sdk/webview-element";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExtensionAction } from "./ExtensionAction";

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
 * The action with `opened` open, resolving with what it next asks `opened` to
 * become.
 */
const trayAsking = (
  extension: Extension,
  opened: string | undefined,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    render(
      <ExtensionAction
        domicile={NO_DOMICILE}
        extension={extension}
        onOpen={resolve}
        opened={opened}
      />,
    );
  });

describe("ExtensionAction", () => {
  describe("rendering", () => {
    it("draws a badge in its color, and none without text", () => {
      render(
        <>
          <ExtensionAction
            domicile={NO_DOMICILE}
            extension={blocker}
            onOpen={() => undefined}
            opened={undefined}
          />
          <ExtensionAction
            domicile={NO_DOMICILE}
            extension={counter}
            onOpen={() => undefined}
            opened={undefined}
          />
        </>,
      );

      expect(screen.getByText("12").style.backgroundColor).toBe("#d93025ff");
      expect(
        screen.getByRole("button", { name: "Blocker: on for this site" })
          .textContent,
      ).toBe("");
    });

    it("holds the popup in a view while it is open, and nothing while not", async () => {
      const { rerender } = render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      expect(document.querySelector("webview")).toBeNull();

      rerender(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );

      expect((await popupView()).getAttribute("src")).toBe(POPUP);
    });

    it("draws the popup's panel flush, with no padding framing the page", async () => {
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );

      await popupView();

      expect(screen.getByRole("dialog")).toHaveAttribute("data-flush");
    });

    it("sizes the popup's view to its content once the page says what that is", async () => {
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );
      const view = await popupView();
      const before = [view.style.inlineSize, view.style.blockSize];

      // The engine's answer, which the element holds and the event announces.
      Object.defineProperties(view, {
        contentHeight: { configurable: true, value: 170 },
        contentWidth: { configurable: true, value: 230 },
      });
      fireEvent(view, new Event(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT));

      expect(before).toStrictEqual(["", ""]);
      await waitFor(() => {
        expect([view.style.inlineSize, view.style.blockSize]).toStrictEqual([
          "230px",
          "170px",
        ]);
      });
    });
  });

  describe("a click", () => {
    it("opens the popup of an extension that has one", async () => {
      const asked = trayAsking(blocker, undefined);

      await userEvent.click(
        screen.getByRole("button", { name: "Blocker: on for this site" }),
      );

      expect(await asked).toBe(BLOCKER);
    });

    it("activates an extension as it opens its popup, and not as it closes it", async () => {
      // The activation is Chrome's toolbar click: it grants the extension
      // `activeTab` on the focused browser window, which the popup's first
      // `scripting.executeScript` needs. The engine dispatches no
      // `action.onClicked` for an action with a popup.
      const activated: string[] = [];
      const { rerender } = render(
        <ExtensionAction
          domicile={recordingDomicile(activated)}
          extension={blocker}
          onOpen={() => undefined}
          opened={undefined}
        />,
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Blocker: on for this site" }),
      );
      rerender(
        <ExtensionAction
          domicile={recordingDomicile(activated)}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );
      await popupView();
      await userEvent.keyboard("{Escape}");

      expect(activated).toStrictEqual([BLOCKER]);
    });

    it("activates an extension that has none, and opens nothing", async () => {
      const activated: string[] = [];
      const opened: (string | undefined)[] = [];
      render(
        <ExtensionAction
          domicile={recordingDomicile(activated)}
          extension={counter}
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
      const asked = trayAsking(blocker, BLOCKER);

      fireEvent(
        await popupView(),
        new Event(WEBVIEW_CLOSE_EVENT, { bubbles: true }),
      );

      expect(await asked).toBeUndefined();
    });

    it("closes on Escape", async () => {
      const asked = trayAsking(blocker, BLOCKER);

      await userEvent.keyboard("{Escape}");

      expect(await asked).toBeUndefined();
    });

    it("closes on a press outside it", async () => {
      const asked = trayAsking(blocker, BLOCKER);

      await userEvent.click(document.body);

      expect(await asked).toBeUndefined();
    });

    it("closes when a click lands in a page outside it", async () => {
      const page = document.createElement("webview");
      document.body.append(page);
      const asked = trayAsking(blocker, BLOCKER);
      await popupView();

      fireEvent.focusIn(page);

      expect(await asked).toBeUndefined();
      page.remove();
    });

    it("stays open when a click lands in its own popup", async () => {
      let asked: string | undefined | null = null;
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={(id) => {
            asked = id;
          }}
          opened={BLOCKER}
        />,
      );

      fireEvent.focusIn(await popupView());

      expect(asked).toBeNull();
    });
  });
});
