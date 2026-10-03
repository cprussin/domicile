// What every item on a monitor's bar can read: the bar's own props, handed
// down through context so an item a user puts on the bar needs none.

import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { createContext, useContext } from "react";

import type { TrayOrder } from "../tray/useTrayOrder";

/** What a monitor's bar knows, and what its items act through. */
export type Bar = {
  /** The workspace on screen, which the bar marks. */
  current: string;
  /**
   * Where the charge and the brightness come from — the bar reads nothing off
   * the machine — and what an extension's action and a new brightness are
   * clicked through.
   */
  domicile: DomicileClient;
  /** The extensions with an action, which the tray shows. */
  extensions: readonly Extension[];
  /** Whether the keyboard is on this screen. */
  focused: boolean;
  /**
   * The binding mode the keys are read in, which the bar names when it is not
   * the usual `default`.
   */
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
  /** The monitor this bar is across, which the mixer opens over. */
  screen: string;
  /** The applications' tray icons. */
  tray: readonly TrayItem[];
  /** The order the tray is in, and how a drag changes it. */
  trayOrder: TrayOrder;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
  /** The workspaces this screen has, which are the ones shown. */
  workspaces: readonly string[];
};

export const BarContext = createContext<Bar | undefined>(undefined);

/**
 * The bar this item is on.
 *
 * Throws outside one: an item of the bar's rendered anywhere else has no
 * screen, workspaces or tray to show, and nothing it could draw instead.
 */
export const useBar = (): Bar => {
  const bar = useContext(BarContext);
  if (bar === undefined) {
    throw new Error("manganese: a bar item was rendered outside the top bar");
  }
  return bar;
};
