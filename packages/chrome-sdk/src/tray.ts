// The system tray, as a shell draws it and clicks it.
//
// Its own module for `theme.ts`'s reason: both halves of the SDK need the
// click's buttons, and only one of them is the wire. `DomicileHost` takes a
// `TrayAction` and `DomicileClient` hands one on; a shell's tray says which.
//
// An icon is an application's StatusNotifierItem, which the compositor hosts
// on the session bus a page cannot reach -- see `crate::tray` in
// `domicile-compositor`. What a click does is the application's.

import { z } from "zod";

/**
 * Which button clicked an icon: StatusNotifierItem's `Activate`,
 * `SecondaryActivate` and `ContextMenu`. The engine's `DomicileTrayAction`,
 * which refuses any other word at the call.
 */
export const trayActionSchema = z.enum(["primary", "secondary", "context"]);

/** Which button clicked a tray icon. */
export type TrayAction = z.infer<typeof trayActionSchema>;

/** One icon in the tray. */
export type TrayItem = {
  /** What {@link DomicileClient.activateTrayItem} names it by. */
  id: string;
  /** What it is, in words, and never empty: what a shell labels it with. */
  title: string;
  /**
   * The picture, as a `data:` URL, or `undefined` for one the compositor could
   * not draw — which leaves a shell the title.
   */
  icon: string | undefined;
};
