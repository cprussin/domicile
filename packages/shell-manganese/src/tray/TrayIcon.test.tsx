import { describe, expect, it, spyOn } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { MenuEntry, watchMenu } from "@domicile-desktop/sdk/dbusmenu";
import { MenuEntry as Entry, ToggleKind } from "@domicile-desktop/sdk/dbusmenu";
import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { TrayAction } from "@domicile-desktop/sdk/tray";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TrayIcon } from "./TrayIcon";

/** An application with an image and a menu. */
const network: DomicileTrayItem = {
  bus: ":1.42",
  icon: "data:image/png;base64,iVBORw0KGgo=",
  id: ":1.42/org/ayatana/nm",
  menu: "/MenuBar",
  title: "Wired connection 1",
};

/** An application whose image the compositor could not decode, with no menu. */
const sync: DomicileTrayItem = {
  bus: "org.kde.StatusNotifierItem-4071-1",
  icon: "",
  id: "org.kde.StatusNotifierItem-4071-1/StatusNotifierItem",
  menu: "",
  title: "Syncthing",
};

const item = (
  id: number,
  label: string,
  more: Partial<Omit<Parameters<typeof Entry.Item>[0], "id" | "label">> = {},
) =>
  Entry.Item({
    enabled: true,
    icon: undefined,
    id,
    label,
    mnemonic: undefined,
    submenu: undefined,
    toggle: undefined,
    ...more,
  });

/** {@link network}'s menu, as `watchMenu` reads it. */
const MENU: readonly MenuEntry[] = [
  item(1, "Open"),
  item(2, "Disconnect", { enabled: false }),
  Entry.Separator(3),
  item(4, "Notifications", {
    toggle: { checked: true, kind: ToggleKind.Checkmark },
  }),
  item(5, "Mode", {
    submenu: [
      item(6, "Automatic", {
        toggle: { checked: false, kind: ToggleKind.Radio },
      }),
      item(7, "Manual", {
        toggle: { checked: true, kind: ToggleKind.Radio },
      }),
    ],
  }),
];

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
    addEventListener: () => undefined,
  } as unknown as DomicileHost;
  return { click, domicile };
};

/** A host for tests that ignore clicks. */
const NO_DOMICILE = {
  activateTrayItem: () => undefined,
  addEventListener: () => undefined,
} as unknown as DomicileHost;

/**
 * A `watchMenu` that reports `menu` at once, and the requests made of it.
 * Each request answers `answer`.
 */
const watching = (
  menu: Result<readonly MenuEntry[], SystemError>,
  answer: Result<never, SystemError> | undefined = undefined,
) => {
  const asked: [string, number | string][] = [];
  const stopped = Promise.withResolvers<void>();
  const watch: typeof watchMenu = (_system, address, onMenu) => {
    asked.push(["watch", `${address.bus}${address.path}`]);
    onMenu(menu);
    return {
      aboutToShow: (id) => {
        asked.push(["aboutToShow", id]);
        return Promise.resolve(answer ?? Ok("shown"));
      },
      click: (id) => {
        asked.push(["click", id]);
        return Promise.resolve(answer ?? Ok("clicked"));
      },
      stop: () => {
        stopped.resolve();
      },
    };
  };
  return { asked, stopped: stopped.promise, watch };
};

const renderIcon = (shown: DomicileTrayItem) => {
  render(<TrayIcon domicile={NO_DOMICILE} item={shown} />);
};

/** Renders `shown`'s icon, resolving with the first click it forwards. */
const iconOf = (shown: DomicileTrayItem, watch?: typeof watchMenu) => {
  const { click, domicile } = clicked();
  render(<TrayIcon domicile={domicile} item={shown} watch={watch} />);
  return click;
};

/** Opens {@link network}'s menu with the secondary button. */
const openMenu = async (watch: typeof watchMenu) => {
  render(<TrayIcon domicile={NO_DOMICILE} item={network} watch={watch} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: network.title }));
  return await screen.findByRole("menu", { name: network.title });
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

    it("asks a menuless application for its menu on the secondary button", async () => {
      const click = iconOf(sync);

      fireEvent.contextMenu(screen.getByRole("button", { name: sync.title }));

      expect(await click).toStrictEqual([sync.id, "context"]);
    });

    it("keeps the page's own menu away from the secondary button", () => {
      renderIcon(sync);

      // `false` means the default was prevented, so the engine's context menu
      // does not open over the application's.
      expect(
        fireEvent.contextMenu(screen.getByRole("button", { name: sync.title })),
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

  describe("the application's menu", () => {
    it("opens on the secondary button and draws its entries", async () => {
      const { asked, watch } = watching(Ok(MENU));

      await openMenu(watch);

      expect(
        screen.getAllByRole("menuitem").map((entry) => entry.textContent),
      ).toStrictEqual(["Open", "Disconnect", "Mode"]);
      expect(
        screen.getByRole("menuitem", { name: "Disconnect" }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("separator")).toBeInTheDocument();
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Notifications" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(asked).toStrictEqual([
        ["watch", ":1.42/MenuBar"],
        ["aboutToShow", 0],
      ]);
    });

    it("clicks the entry chosen, then closes and stops watching", async () => {
      const user = userEvent.setup();
      const { asked, stopped, watch } = watching(Ok(MENU));
      await openMenu(watch);

      await user.click(screen.getByRole("menuitem", { name: "Open" }));

      await stopped;
      expect(asked).toContainEqual(["click", 1]);
    });

    it("clicks a toggle", async () => {
      const user = userEvent.setup();
      const { asked, watch } = watching(Ok(MENU));
      await openMenu(watch);

      await user.click(
        screen.getByRole("menuitemcheckbox", { name: "Notifications" }),
      );

      expect(asked).toContainEqual(["click", 4]);
    });

    it("prepares a submenu and draws its radio items", async () => {
      const user = userEvent.setup();
      const { asked, watch } = watching(Ok(MENU));
      await openMenu(watch);

      await user.click(screen.getByRole("menuitem", { name: "Mode" }));

      expect(
        await screen.findByRole("menuitemradio", { name: "Manual" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("menuitemradio", { name: "Automatic" }),
      ).toHaveAttribute("aria-checked", "false");
      expect(asked).toContainEqual(["aboutToShow", 5]);
    });

    it("says when the menu cannot be read", async () => {
      const { watch } = watching(
        Err({
          kind: SystemErrorKind.Dbus,
          message: "org.freedesktop.DBus.Error.ServiceUnknown: gone",
        }),
      );

      await openMenu(watch);

      expect(
        screen.getByRole("menuitem", { name: "Menu unavailable" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("logs a request the application refused", async () => {
      const user = userEvent.setup();
      const refused: SystemError = {
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.UnknownMethod: no Event",
      };
      const logged = Promise.withResolvers<unknown[]>();
      const { watch } = watching(Ok(MENU), Err(refused));
      // The first is `aboutToShow`'s, on opening.
      spyOn(console, "error")
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce((...args) => {
          logged.resolve(args);
        });
      await openMenu(watch);

      await user.click(screen.getByRole("menuitem", { name: "Open" }));

      expect(await logged.promise).toStrictEqual([
        "A tray menu refused a request",
        refused,
      ]);
    });
  });
});
