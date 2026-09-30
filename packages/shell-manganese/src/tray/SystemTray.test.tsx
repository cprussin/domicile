import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { TrayAction, TrayItem } from "@domicile/chrome-sdk/tray";
import { fireEvent, render, screen } from "@testing-library/react";

import { SystemTray } from "./SystemTray";

/** An application that sent a picture. */
const network: TrayItem = {
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id: ":1.42/org/ayatana/nm",
  title: "Wired connection 1",
};

/** And one whose picture the compositor could not draw. */
const sync: TrayItem = {
  icon: undefined,
  id: "org.kde.StatusNotifierItem-4071-1/StatusNotifierItem",
  title: "Syncthing",
};

/** A client resolving with the first click the tray hands it. */
const clicked = (): {
  domicile: DomicileClient;
  click: Promise<[string, TrayAction]>;
} => {
  let heard: (click: [string, TrayAction]) => void = () => undefined;
  const click = new Promise<[string, TrayAction]>((resolve) => {
    heard = resolve;
  });
  const domicile = {
    activateTrayItem: (id: string, action: TrayAction) => {
      heard([id, action]);
    },
  } as unknown as DomicileClient;
  return { click, domicile };
};

/** A client for a tray whose clicks the test does not read. */
const NO_DOMICILE = {
  activateTrayItem: () => undefined,
} as unknown as DomicileClient;

const renderTray = (items: readonly TrayItem[]) => {
  render(<SystemTray domicile={NO_DOMICILE} items={items} />);
};

/** The tray over `items`, resolving with the first click it hands on. */
const trayOf = (items: readonly TrayItem[]) => {
  const { click, domicile } = clicked();
  render(<SystemTray domicile={domicile} items={items} />);
  return click;
};

describe("SystemTray", () => {
  describe("rendering", () => {
    it("shows each icon in order, named by its title", () => {
      renderTray([network, sync]);

      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toStrictEqual(["Wired connection 1", "Syncthing"]);
      expect(
        screen
          .getByRole("button", { name: "Wired connection 1" })
          .querySelector("img")
          ?.getAttribute("src"),
      ).toBe(network.icon);
    });

    it("draws the first letter of the title for an icon with no picture", () => {
      renderTray([sync]);

      const button = screen.getByRole("button", { name: "Syncthing" });
      expect(button.querySelector("img")).toBeNull();
      expect(button.textContent).toBe("S");
    });
  });

  describe("clicking", () => {
    it("activates an icon on the primary button", async () => {
      const click = trayOf([network]);

      fireEvent.click(screen.getByRole("button", { name: network.title }));

      expect(await click).toStrictEqual([network.id, "primary"]);
    });

    it("asks for the application's menu on the secondary button", async () => {
      const click = trayOf([network]);

      fireEvent.contextMenu(
        screen.getByRole("button", { name: network.title }),
      );

      expect(await click).toStrictEqual([network.id, "context"]);
    });

    it("keeps the page's own menu away from the secondary button", () => {
      renderTray([network]);

      // `false` is a default that was prevented: the engine's context menu
      // would otherwise open over the application's.
      expect(
        fireEvent.contextMenu(
          screen.getByRole("button", { name: network.title }),
        ),
      ).toBe(false);
    });

    it("secondary-activates an icon on the middle button", async () => {
      const click = trayOf([network]);

      fireEvent(
        screen.getByRole("button", { name: network.title }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );

      expect(await click).toStrictEqual([network.id, "secondary"]);
    });
  });
});
