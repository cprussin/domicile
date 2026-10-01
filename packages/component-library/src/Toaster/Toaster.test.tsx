import { describe, expect, it } from "bun:test";
import {
  act,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";

import { createToastManager, Toaster } from "./Toaster";

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
});
