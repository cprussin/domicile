import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";

import { springTransition } from "../__test__/spring-transition";
import { createToastManager, TextToaster, Toaster } from "./Toaster";

/** A toaster over `manager`, each toast drawn as its title and description. */
const toaster = (manager: ReturnType<typeof createToastManager>) =>
  render(
    <Toaster.Provider toastManager={manager}>
      <Toaster label="Notifications">
        {() => (
          <>
            <Toaster.Title />
            <Toaster.Description />
          </>
        )}
      </Toaster>
    </Toaster.Provider>,
  );

describe(Toaster, () => {
  describe("rendering", () => {
    it("draws each toast the manager is given, in a labeled region", async () => {
      const manager = createToastManager();
      toaster(manager);

      act(() => {
        manager.add({ description: "Ada: lunch?", title: "New message" });
      });

      expect(await screen.findByText("New message")).toBeInTheDocument();
      expect(screen.getByText("Ada: lunch?")).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: /Notifications/ }),
      ).toBeInTheDocument();
    });

    it("hands each toast to the caller to draw", async () => {
      const manager = createToastManager();
      render(
        <Toaster.Provider toastManager={manager}>
          <Toaster label="Notifications">
            {(toast) => <p>drawn: {String(toast.title)}</p>}
          </Toaster>
        </Toaster.Provider>,
      );

      act(() => {
        manager.add({ title: "Downloaded" });
      });

      expect(await screen.findByText("drawn: Downloaded")).toBeInTheDocument();
    });

    it("says a danger toast is one, so the stylesheet can mark it", async () => {
      const manager = createToastManager();
      toaster(manager);

      act(() => {
        manager.add({ title: "Battery low", type: "danger" });
      });

      const title = await screen.findByText("Battery low");
      expect(title.closest("[data-type]")).toHaveAttribute(
        "data-type",
        "danger",
      );
    });
  });

  describe("the countdown", () => {
    it("runs for as long as a toast stays up", async () => {
      const manager = createToastManager();
      toaster(manager);

      act(() => {
        manager.add({ timeout: 6000, title: "Downloaded" });
      });

      const title = await screen.findByText("Downloaded");
      const countdown = title
        .closest("[data-toast]")
        ?.querySelector("[data-toast-countdown]");
      expect(countdown).toHaveStyle({ "--toast-timeout": "6000ms" });
    });

    it("is not drawn for a toast that stays until it is dismissed", async () => {
      const manager = createToastManager();
      const { container } = toaster(manager);

      act(() => {
        manager.add({ timeout: 0, title: "Battery critical" });
      });

      await screen.findByText("Battery critical");
      expect(
        container.ownerDocument.querySelector("[data-toast-countdown]"),
      ).toBeNull();
    });
  });

  describe("closing", () => {
    it("takes a toast down when the manager closes it", async () => {
      const manager = createToastManager();
      toaster(manager);
      let id = "";
      act(() => {
        id = manager.add({ timeout: 0, title: "Downloaded" });
      });
      await screen.findByText("Downloaded");

      act(() => {
        manager.close(id);
      });

      await waitForElementToBeRemoved(() => screen.queryByText("Downloaded"));
    });
  });

  describe("motion", () => {
    loadEmittedStylesheet(
      document,
      new URL("../../styled-system/styles.css", import.meta.url),
    );

    /** The root of a toast titled "Saved", once it is drawn. */
    const shown = async (): Promise<HTMLElement> => {
      const manager = createToastManager();
      toaster(manager);
      act(() => {
        manager.add({ title: "Saved" });
      });
      const root = (await screen.findByText("Saved")).closest("[data-toast]");
      if (root instanceof HTMLElement) {
        return root;
      } else {
        throw new Error("the toast has no root");
      }
    };

    it("arrives and restacks on the smooth spring", async () => {
      expect(globalThis.getComputedStyle(await shown()).transition).toContain(
        springTransition("transform", "smooth"),
      );
    });

    it("leaves on the snappy spring when it times out or is closed", async () => {
      const root = await shown();
      root.setAttribute("data-ending-style", "");
      expect(globalThis.getComputedStyle(root).transition).toContain(
        springTransition("transform", "snappy"),
      );
    });

    it("keeps the speed it was swiped at as it leaves", async () => {
      const root = await shown();
      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(root, { clientX: 40, clientY: 10 });
      fireEvent.pointerMove(root, { clientX: 90, clientY: 10 });
      fireEvent.pointerUp(root, { clientX: 90, clientY: 10 });
      expect(root.style.getPropertyValue("--toast-fling")).toMatch(/^\d+ms$/);

      root.style.setProperty("--toast-fling", "120ms");
      root.setAttribute("data-ending-style", "");
      root.setAttribute("data-swipe-direction", "right");
      expect(globalThis.getComputedStyle(root).transition).toContain(
        "transform 120ms linear",
      );
    });
  });

  describe("pressing", () => {
    /**
     * A toast drawn as a clickable card, with each click it gets kept in
     * `clicks`.
     */
    const clickable = async (clicks: string[]) => {
      const manager = createToastManager();
      render(
        <Toaster.Provider toastManager={manager}>
          <Toaster label="Notifications">
            {() => (
              // biome-ignore lint/a11y/noStaticElementInteractions: stands in for a card the pointer presses
              // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the same stand-in
              // biome-ignore lint/a11y/useKeyWithClickEvents: the same stand-in
              <div
                onClick={() => {
                  clicks.push("card");
                }}
              >
                <Toaster.Title />
              </div>
            )}
          </Toaster>
        </Toaster.Provider>,
      );
      act(() => {
        manager.add({ title: "New message" });
      });
      const title = await screen.findByText("New message");
      const toast = title.closest("[data-toast]");
      if (toast === null) {
        throw new Error("the toast has no root");
      } else {
        return { title, toast };
      }
    };

    // The swipe captures the pointer on the toast's root, so the browser
    // sends a press's click to the root rather than to what was pressed.
    it("clicks what a press started on when the swipe took its click", async () => {
      const clicks: string[] = [];
      const { title, toast } = await clickable(clicks);

      fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.click(toast, { clientX: 11, clientY: 10 });

      expect(clicks).toEqual(["card"]);
    });

    it("clicks nothing at the end of a drag", async () => {
      const clicks: string[] = [];
      const { title, toast } = await clickable(clicks);

      fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.click(toast, { clientX: 60, clientY: 10 });

      expect(clicks).toEqual([]);
    });

    it("leaves a click that reached its target alone", async () => {
      const clicks: string[] = [];
      const { title } = await clickable(clicks);

      fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.click(title, { clientX: 10, clientY: 10 });

      expect(clicks).toEqual(["card"]);
    });
  });
});

describe(TextToaster, () => {
  const textToaster = () => {
    const manager = createToastManager();
    render(
      <Toaster.Provider toastManager={manager}>
        <TextToaster label="Notifications" />
      </Toaster.Provider>,
    );
    return manager;
  };

  it("draws a toast's title and description", async () => {
    const manager = textToaster();
    act(() => {
      manager.add({ description: "Ada: lunch?", title: "New message" });
    });

    expect(
      await screen.findByRole("dialog", { name: "New message" }),
    ).toHaveAccessibleDescription("Ada: lunch?");
  });

  it("draws only the title of a toast without a description", async () => {
    const manager = textToaster();
    act(() => {
      manager.add({ title: "Browsing data cleared" });
    });

    expect(
      await screen.findByRole("dialog", { name: "Browsing data cleared" }),
    ).not.toHaveAccessibleDescription();
  });
});
