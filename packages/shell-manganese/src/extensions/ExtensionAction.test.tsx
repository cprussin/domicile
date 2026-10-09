import { describe, expect, it } from "bun:test";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_CONTENT_SIZE_CHANGE_EVENT,
  WEBVIEW_PERMISSION_REQUEST_EVENT,
} from "@domicile-desktop/sdk/webview-element";
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

/** An extension whose click fires `action.onClicked`, with a badge set. */
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

/** A host that records every extension the tray activated, in order. */
const recordingDomicile = (activated: string[]): DomicileHost =>
  ({
    activateExtension: (id: string) => {
      activated.push(id);
    },
  }) as unknown as DomicileHost;

const NO_DOMICILE = recordingDomicile([]);

/**
 * The popup's view, portaled to the body, once base-ui has positioned it (a
 * tick after mount).
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

/** The action with `opened` open; resolves with the next `opened` requested. */
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

/**
 * A fake engine camera request from the popup, recording its answers. Built
 * by hand because the test DOM lacks the engine's event type.
 */
const askCamera = (view: HTMLWebViewElement, answers: string[]) => {
  fireEvent(
    view,
    Object.assign(
      new Event(WEBVIEW_PERMISSION_REQUEST_EVENT, { cancelable: true }),
      {
        allow: () => {
          answers.push("allow");
        },
        deny: () => {
          answers.push("deny");
        },
        dismiss: () => {
          answers.push("dismiss");
        },
        origin: `chrome-extension://${BLOCKER}`,
        permissions: ["camera"],
      },
    ),
  );
};

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

    it("marks the popup's view an extension popup, so its page is no tab", async () => {
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );

      expect((await popupView()).hasAttribute("extensionpopup")).toBe(true);
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

      // The engine's reply, held by the element and announced by the event.
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
      // Activation mimics Chrome's toolbar click: it grants `activeTab` on the
      // focused browser window, which the popup's `scripting.executeScript`
      // needs. The engine sends no `action.onClicked` when there is a popup.
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

  describe("a permission request from the popup", () => {
    it("asks in the panel, naming the extension", async () => {
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );

      askCamera(await popupView(), []);

      expect(await screen.findByText("Blocker")).toBeInTheDocument();
      expect(screen.getByText("Camera")).toBeInTheDocument();
    });

    it("answers it, and stops asking", async () => {
      const answers: string[] = [];
      render(
        <ExtensionAction
          domicile={NO_DOMICILE}
          extension={blocker}
          onOpen={() => undefined}
          opened={BLOCKER}
        />,
      );
      askCamera(await popupView(), answers);

      await userEvent.click(
        await screen.findByRole("button", { name: "Allow" }),
      );

      expect(answers).toStrictEqual(["allow"]);
      expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
    });
  });
});
