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
  | "ungrabShortcut"
>;

/**
 * Grab every chord applications hold, and report each press and release.
 * Returns a function that stops reporting.
 *
 * A chord no application holds any more is given back, and so is every chord
 * on stop. A keysym the layout cannot type is logged once, so the other chords
 * still work.
 */
export const fireGlobalShortcuts = (
  host: GlobalShortcutsHost,
): (() => void) => {
  // Each chord tried, and whether the engine took it: only a chord it took is
  // given back, so another grab of the same chord is left alone.
  const grabbed = new Map<string, boolean>();
  let byChord = new Map<string, readonly number[]>();

  const stopWatching = watchBoundShortcuts(host, (shortcuts) => {
    const held = new Set(shortcuts.map(({ chord }) => chord));
    for (const chord of held) {
      if (!grabbed.has(chord)) {
        grabbed.set(chord, grab(host, chord));
      }
    }
    for (const [chord, took] of grabbed) {
      if (!held.has(chord)) {
        grabbed.delete(chord);
        if (took) {
          host.ungrabShortcut(chord);
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
    for (const [chord, took] of grabbed) {
      if (took) {
        host.ungrabShortcut(chord);
      }
    }
    grabbed.clear();
  };
};

/** Grab `chord`, and say whether the engine took it. */
const grab = (host: GlobalShortcutsHost, chord: string): boolean => {
  try {
    host.grabShortcut(chord);
    return true;
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: the user fixes a chord the layout cannot type, so the shell reports it
    console.error(error);
    return false;
  }
};
