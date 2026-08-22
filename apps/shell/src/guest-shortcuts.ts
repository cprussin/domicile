// The key combinations the chrome has claimed from the pages it embeds.
//
// A `<webview>` is a browsing context of its own, and a key pressed inside one
// is given to it and to nothing else: the shell's page never hears it, so the
// moment a browser window has the keyboard, the combination that would open
// another window goes to whatever site is on screen instead. That is the
// problem the compositor solves for a Wayland client — see
// `packages/domicile-compositor/src/shortcut.rs` — and it is solved the same
// way here. The page claims what it wants, and the layer that dispatches the
// key takes a claimed one out of the stream before the guest is given it.
//
// Which layer that is depends on how the chrome is being run, and the two
// never both fire. Where Domicile composites this window the compositor holds
// the keyboard and the key never reaches Electron at all; where it does not —
// the copy path, and a shell started on someone else's desktop — the main
// process is the only thing above a guest that sees the key first.
//
import type { Chord } from "./chord";
import {
  CHROME_GRAB_SHORTCUT_CHANNEL,
  CHROME_SHORTCUT_CHANNEL,
} from "./ipc-channels";

/** Electron's name for the half of a keystroke that opens a shortcut. */
const PRESS = "keyDown";

/** The window's own page: where a claim comes from, and where a press goes. */
type Page = {
  on: (
    event: "did-attach-webview",
    listener: (event: unknown, guest: Guest) => void,
  ) => void;
  once: (event: "destroyed", listener: () => void) => void;
  send: (channel: string, chord: Chord) => void;
};

/** An embedded browsing context, whose keys the host is given first. */
type Guest = {
  on: (
    event: "before-input-event",
    listener: (event: GuestEvent, key: GuestKey) => void,
  ) => void;
};

/** `before-input-event`: the guest is given the key unless this is called. */
type GuestEvent = {
  preventDefault: () => void;
};

/** The parts of Electron's `Input` a chord is matched against. */
type GuestKey = {
  alt: boolean;
  code: string;
  control: boolean;
  isAutoRepeat: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
};

/** A page claiming a combination, and the page it came from. */
type Claim = (event: { sender: unknown }, chord: Chord) => void;

/**
 * The main process's IPC. It is the whole process's rather than one window's,
 * which is why a claim carries its sender and why the listener comes back off
 * again.
 */
type Ipc = {
  off: (channel: string, listener: Claim) => void;
  on: (channel: string, listener: Claim) => void;
};

/**
 * Take the combinations `page` claims out of every guest it embeds, and give
 * each press back to it.
 *
 * Wired per window rather than per guest: a claim is the whole page's, and the
 * windows it embeds come and go under it. `ipcMain` is the whole *process's*,
 * though, so the claims another window made are on this channel too — they are
 * that window's wiring's, and this one takes only its own page's and gives the
 * listener back when that page is gone.
 */
export const takeGuestShortcuts = (page: Page, ipc: Ipc): void => {
  const shortcuts = new GuestShortcuts();
  const claim: Claim = (event, chord) => {
    if (event.sender === page) {
      shortcuts.grab(chord);
    }
  };
  ipc.on(CHROME_GRAB_SHORTCUT_CHANNEL, claim);
  page.once("destroyed", () => {
    ipc.off(CHROME_GRAB_SHORTCUT_CHANNEL, claim);
  });
  page.on("did-attach-webview", (_event, guest) => {
    guest.on("before-input-event", (event, key) => {
      shortcuts.intercept(event, key, (chord) => {
        page.send(CHROME_SHORTCUT_CHANNEL, chord);
      });
    });
  });
};

/** The combinations claimed, and what they do to a guest's keys. */
class GuestShortcuts {
  readonly #claimed = new Set<string>();

  // The keys whose press was taken, so their release can be taken too. Held by
  // key rather than by chord because a chord comes apart in whatever order the
  // user lets go: releasing Alt before Enter makes the release that follows
  // plain Enter, which is not the claimed combination and would otherwise be
  // handed to the guest.
  //
  // By `code` — the keyboard's own name for the key — rather than by `key`,
  // which names the character the modifiers produced and so is not the same
  // string on the way up as it was on the way down: Alt+Shift+T goes down as
  // `T` and comes up as `t`. It also tells the two Enters apart, which `key`
  // does not.
  readonly #taken = new Set<string>();

  /**
   * Claim a combination. Claiming one twice is one claim, not an error: a page
   * that reloads re-registers everything it wants.
   */
  grab(chord: Chord): void {
    this.#claimed.add(nameOf(chord));
  }

  /**
   * Take `key` out of the guest's stream if the page claimed it, handing the
   * press to `deliver`.
   *
   * The release of a press that was taken is taken as well, and delivered to
   * nobody: a guest given half a chord sees a key go up that it never saw go
   * down, and a page tracking modifiers of its own is left holding one that is
   * not held any more. A repeat is taken and not delivered either — a key held
   * down produces tens of them a second, and a launcher that answered every
   * one would open a window for each. The compositor never sees a repeat at
   * all, because Wayland leaves the repeating to the client.
   *
   * A press does not always have a release to pair with: opening a window is
   * what a press is for, and the window can take the focus away before the key
   * comes up. The entry is left behind, which costs at most one release taken
   * from the next press of that key — and there is one entry per key, so what
   * is left behind is bounded rather than accumulating.
   */
  intercept(
    event: GuestEvent,
    key: GuestKey,
    deliver: (chord: Chord) => void,
  ): void {
    if (key.type === PRESS) {
      this.#takePress(event, key, deliver);
    } else {
      this.#takeRelease(event, key);
    }
  }

  #takePress(
    event: GuestEvent,
    key: GuestKey,
    deliver: (chord: Chord) => void,
  ): void {
    const chord = chordOf(key);
    if (this.#claimed.has(nameOf(chord))) {
      event.preventDefault();
      this.#taken.add(key.code);
      if (!key.isAutoRepeat) {
        deliver(chord);
      }
    }
  }

  // A release is taken only where the press of it was, so one the guest is
  // owed is left alone — which is what a page claiming a combination that is
  // already held produces. "Where the press was" and "where the guest never
  // saw one" are not quite the same thing: a chord completed while its key was
  // already down records that key from the repeats, and the release is taken
  // for a press the guest did see. The alternative loses the case that
  // matters more — focus arriving on a guest mid-chord, which is the one that
  // happens every time a launched window takes it.
  #takeRelease(event: GuestEvent, key: GuestKey): void {
    if (this.#taken.has(key.code)) {
      this.#taken.delete(key.code);
      event.preventDefault();
    }
  }
}

// The combination this key amounts to. Electron reports the modifiers under
// the names the DOM gives them, one of which is not the name a chord uses.
const chordOf = (key: GuestKey): Chord => ({
  alt: key.alt,
  ctrl: key.control,
  key: key.key,
  meta: key.meta,
  shift: key.shift,
});

// A chord as one comparable value, so a claim is a set membership rather than
// a scan. Every modifier is part of the name: one being held that the claim
// does not name makes this a different combination, which is what keeps
// Alt+Shift+Enter from answering a claim on Alt+Enter.
const nameOf = (chord: Chord): string =>
  [
    chord.alt ? "alt" : "",
    chord.ctrl ? "ctrl" : "",
    chord.meta ? "meta" : "",
    chord.shift ? "shift" : "",
    chord.key,
  ].join("+");
