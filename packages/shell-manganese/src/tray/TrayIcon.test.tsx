import { describe, expect, it } from "bun:test";
import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import type { TrayAction } from "@domicile-desktop/sdk/tray";
import { fireEvent, render, screen } from "@testing-library/react";

import { TrayIcon } from "./TrayIcon";

/** An application with an image. */
const network: DomicileTrayItem = {
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id: ":1.42/org/ayatana/nm",
  title: "Wired connection 1",
};

/** An application whose image the compositor could not decode. */
const sync: DomicileTrayItem = {
  icon: "",
  id: "org.kde.StatusNotifierItem-4071-1/StatusNotifierItem",
  title: "Syncthing",
};

/** A host that resolves with the first click the tray forwards. */
const clicked = (): {
  domicile: DomicileHost;
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
  } as unknown as DomicileHost;
  return { click, domicile };
};

/** A host for tests that ignore clicks. */
const NO_DOMICILE = {
  activateTrayItem: () => undefined,
} as unknown as DomicileHost;

const renderIcon = (item: DomicileTrayItem) => {
  render(<TrayIcon domicile={NO_DOMICILE} item={item} />);
};

/** Renders `item`'s icon, resolving with the first click it forwards. */
const iconOf = (item: DomicileTrayItem) => {
  const { click, domicile } = clicked();
  render(<TrayIcon domicile={domicile} item={item} />);
  return click;
};

describe("TrayIcon", () => {
  describe("rendering", () => {
    it("shows the picture, named by its title", () => {
      renderIcon(network);

      expect(
        screen
          .getByRole("button", { name: "Wired connection 1" })
          .querySelector("img")
          ?.getAttribute("src"),
      ).toBe(network.icon);
    });

    it("draws the first letter of the title for an icon with no picture", () => {
      renderIcon(sync);

      const button = screen.getByRole("button", { name: "Syncthing" });
      expect(button.querySelector("img")).toBeNull();
      expect(button.textContent).toBe("S");
    });
  });

  describe("clicking", () => {
    it("activates an icon on the primary button", async () => {
      const click = iconOf(network);

      fireEvent.click(screen.getByRole("button", { name: network.title }));

      expect(await click).toStrictEqual([network.id, "primary"]);
    });

    it("asks for the application's menu on the secondary button", async () => {
      const click = iconOf(network);

      fireEvent.contextMenu(
        screen.getByRole("button", { name: network.title }),
      );

      expect(await click).toStrictEqual([network.id, "context"]);
    });

    it("keeps the page's own menu away from the secondary button", () => {
      renderIcon(network);

      // `false` means the default was prevented, so the engine's context menu
      // does not open over the application's.
      expect(
        fireEvent.contextMenu(
          screen.getByRole("button", { name: network.title }),
        ),
      ).toBe(false);
    });

    it("secondary-activates an icon on the middle button", async () => {
      const click = iconOf(network);

      fireEvent(
        screen.getByRole("button", { name: network.title }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );

      expect(await click).toStrictEqual([network.id, "secondary"]);
    });
  });
});
