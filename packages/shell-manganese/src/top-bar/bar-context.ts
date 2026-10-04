// Context for bar items, so items in a user's layout need no props.

import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { createContext, useContext } from "react";

import type { TrayOrder } from "../tray/useTrayOrder";

/** What a monitor's bar provides to its items. */
export type Bar = {
  /** The workspace on screen. */
  current: string;
  /**
   * The source of battery and brightness readings, and the target for extension
   * actions and brightness changes.
   */
  domicile: DomicileClient;
  /** The extensions with an action, shown in the tray. */
  extensions: readonly Extension[];
  /** Whether this screen has keyboard focus. */
  focused: boolean;
  /** The current binding mode; the bar shows it unless it is `default`. */
  mode: string;
  /** Open an extension's popup, or close the open one with `undefined`. */
  onOpenExtension: (id: string | undefined) => void;
  /** Open the launcher. */
  onOpenLauncher: () => void;
  /** Open the drawer of notifications. */
  onOpenNotifications: () => void;
  onSelectWorkspace: (name: string) => void;
  /** The extension whose popup is open, or `undefined`. */
  openedExtension: string | undefined;
  /** The monitor this bar is on, which the mixer opens over. */
  screen: string;
  /** The applications' tray icons. */
  tray: readonly TrayItem[];
  /** The tray order and how to change it by dragging. */
  trayOrder: TrayOrder;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
  /** This screen's workspaces. */
  workspaces: readonly string[];
};

export const BarContext = createContext<Bar | undefined>(undefined);

/**
 * The bar this item is on.
 *
 * Throws outside a bar, since an item has nothing to show without one.
 */
export const useBar = (): Bar => {
  const bar = useContext(BarContext);
  if (bar === undefined) {
    throw new Error("manganese: a bar item was rendered outside the top bar");
  }
  return bar;
};
