// Fires the chords applications hold through the GlobalShortcuts portal.
//
// The compositor lists them with each `portalrequests` push. Each is grabbed
// as the shell grabs its own keys, and a press and its release are reported to
// the compositor, which signals the application. See docs/PORTALS.md.

import type { Keyboard } from "./desktop/keyboard";
import type { Portals } from "./desktop/portals";

/** What {@link fireGlobalShortcuts} needs of the desktop. */
export type GlobalShortcutsDesktop = {
  readonly keyboard: Pick<Keyboard, "grab" | "on" | "ungrab">;
  readonly portals: Pick<Portals, "boundShortcuts" | "fireShortcut" | "on">;
};

/**
 * Grab every chord applications hold, and report each press and release.
 * Returns a function that stops reporting.
 *
 * A chord no application holds any more is given back, and so is every chord
 * on stop. A keysym the layout cannot type is logged once, so the other chords
 * still work.
 */
export const fireGlobalShortcuts = ({
  keyboard,
  portals,
}: GlobalShortcutsDesktop): (() => void) => {
  // Each chord tried, and whether the engine took it: only a chord it took is
  // given back, so another grab of the same chord is left alone.
  const grabbed = new Map<string, boolean>();
  let byChord = new Map<string, readonly number[]>();

  const heard = () => {
    const shortcuts = portals.boundShortcuts;
    if (shortcuts === undefined) {
      return;
    }
    const held = new Set(shortcuts.map(({ chord }) => chord));
    for (const chord of held) {
      if (!grabbed.has(chord)) {
        grabbed.set(chord, grab(keyboard, chord));
      }
    }
    for (const [chord, took] of grabbed) {
      if (!held.has(chord)) {
        grabbed.delete(chord);
        if (took) {
          keyboard.ungrab(chord);
        }
      }
    }
    byChord = shortcuts.reduce(
      (by, { chord, id }) => by.set(chord, [...(by.get(chord) ?? []), id]),
      new Map<string, readonly number[]>(),
    );
  };
  const stopWatching = portals.on("change", heard);
  heard();
  const report =
    (kind: "pressed" | "released") =>
    ({ chord }: { readonly chord: string }) => {
      for (const id of byChord.get(chord) ?? []) {
        portals.fireShortcut(id, kind);
      }
    };
  const stopPress = keyboard.on("shortcut", report("pressed"));
  const stopRelease = keyboard.on("shortcutrelease", report("released"));

  return () => {
    stopWatching();
    stopPress();
    stopRelease();
    for (const [chord, took] of grabbed) {
      if (took) {
        keyboard.ungrab(chord);
      }
    }
    grabbed.clear();
  };
};

/** Grab `chord`, and say whether the engine took it. */
const grab = (keyboard: Pick<Keyboard, "grab">, chord: string): boolean => {
  try {
    keyboard.grab(chord);
    return true;
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: the user fixes a chord the layout cannot type, so the shell reports it
    console.error(error);
    return false;
  }
};
