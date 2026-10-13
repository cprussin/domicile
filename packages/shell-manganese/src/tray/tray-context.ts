// The tray's state, held once for every bar's tray.

import type { DomicileTrayItem } from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { createContext } from "react";

import { useProvided } from "../host/use-provided";
import type { TrayOrder } from "./useTrayOrder";

export type TrayState = {
  /** The extensions with an action. */
  extensions: readonly Extension[];
  /** The applications' tray icons. */
  items: readonly DomicileTrayItem[];
  /** Open an extension's popup on `screen`, or close it with `undefined`. */
  open: (screen: string, extension: string | undefined) => void;
  /** The open extension popup and the screen it is on. */
  opened: { extension: string; screen: string } | undefined;
  /** The icon order, shared so a drag on one bar reorders every bar. */
  order: TrayOrder;
};

export const TrayContext = createContext<TrayState | undefined>(undefined);

/** The tray from {@link TrayContext}. */
export const useTrayState = (): TrayState =>
  useProvided(TrayContext, "the tray (TrayContext)");
