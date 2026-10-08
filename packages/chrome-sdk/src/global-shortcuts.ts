// Fires the chords applications hold through the GlobalShortcuts portal.
//
// The compositor lists them with each `portalrequests` push. Each is grabbed
// as the shell grabs its own keys, and a press and its release are reported to
// the compositor, which signals the application. See docs/PORTALS.md.

import type { DomicileHost } from "./domicile-host";
import { watchBoundShortcuts } from "./portal";

/** What {@link fireGlobalShortcuts} needs of the desktop `Shell` is handed. */
export type GlobalShortcutsHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "answerPortalRequest"
  | "grabShortcut"
  | "removeEventListener"
>;

/**
 * Grab every chord applications hold, and report each press and release.
 * Returns a function that stops reporting.
 *
 * Grabs are never released (see `bindKeys`), so a chord an application let go
 * of stays grabbed and reports nothing. A keysym the layout cannot type is
 * logged, so the other chords still work.
 */
export const fireGlobalShortcuts = (
  host: GlobalShortcutsHost,
): (() => void) => {
  const grabbed = new Set<string>();
  let byChord = new Map<string, readonly number[]>();

  const stopWatching = watchBoundShortcuts(host, (shortcuts) => {
    for (const { chord } of shortcuts) {
      if (!grabbed.has(chord)) {
        grabbed.add(chord);
        try {
          host.grabShortcut(chord);
        } catch (error) {
          // biome-ignore lint/suspicious/noConsole: the user fixes a chord the layout cannot type, so the shell reports it
          console.error(error);
        }
      }
    }
    byChord = shortcuts.reduce(
      (by, { chord, id }) => by.set(chord, [...(by.get(chord) ?? []), id]),
      new Map<string, readonly number[]>(),
    );
  });
  const report =
    (kind: "pressed" | "released") =>
    ({ chord }: { readonly chord: string }) => {
      for (const id of byChord.get(chord) ?? []) {
        host.answerPortalRequest(id, JSON.stringify({ kind }));
      }
    };
  const onShortcut = report("pressed");
  const onRelease = report("released");
  host.addEventListener("shortcut", onShortcut);
  host.addEventListener("shortcutrelease", onRelease);

  return () => {
    stopWatching();
    host.removeEventListener("shortcut", onShortcut);
    host.removeEventListener("shortcutrelease", onRelease);
  };
};
