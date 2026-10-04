// System tray types for shells.
//
// Each icon is an application's StatusNotifierItem, hosted by the compositor
// on the session bus. See `docs/architecture/SYSTEM-TRAY.md`.

import { z } from "zod";

/**
 * Which button clicked an icon: StatusNotifierItem's `Activate`,
 * `SecondaryActivate` and `ContextMenu`. Matches the engine's
 * `DomicileTrayAction`.
 */
export const trayActionSchema = z.enum(["primary", "secondary", "context"]);

/** Which button clicked a tray icon. */
export type TrayAction = z.infer<typeof trayActionSchema>;

/** One icon in the tray. */
export type TrayItem = {
  /**
   * The id for `DomicileHost.activateTrayItem`. Stable across
   * application restarts.
   */
  id: string;
  /** A non-empty label. */
  title: string;
  /** The icon as a `data:` URL, or `undefined` if it could not be rendered. */
  icon: string | undefined;
};
