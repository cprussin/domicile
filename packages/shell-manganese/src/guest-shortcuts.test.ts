import { describe, expect, it } from "bun:test";

import type { Chord } from "./chord";
import { takeGuestShortcuts } from "./guest-shortcuts";
import {
  CHROME_GRAB_SHORTCUT_CHANNEL,
  CHROME_SHORTCUT_CHANNEL,
} from "./shortcut-channels";

/** Alt+Enter, as the shell claims it: the chord that opens a terminal. */
const ALT_ENTER: Chord = {
  alt: true,
  ctrl: false,
  key: "Enter",
  meta: false,
  shift: false,
};

/**
 * Alt+Shift+T, standing in for any claim on a printable key: `key` is the
 * character the modifiers produce, so it is not the same string on the way up
 * as it was on the way down.
 */
const ALT_SHIFT_T: Chord = {
  alt: true,
  ctrl: false,
  key: "T",
  meta: false,
  shift: true,
};

/** A key a guest is about to be given, in the shape Electron reports it. */
const press = (over: Record<string, unknown> = {}) => ({
  alt: true,
  code: "Enter",
  control: false,
  isAutoRepeat: false,
  key: "Enter",
  meta: false,
  shift: false,
  type: "keyDown",
  ...over,
});

describe("takeGuestShortcuts", () => {
  it("gives the page a claimed chord pressed in a guest, and takes it from the guest", () => {
    const host = hosting();
    const given = host.press();

    expect(host.page.sent).toStrictEqual([
      [CHROME_SHORTCUT_CHANNEL, ALT_ENTER],
    ]);
    expect(given).toBe(false);
  });

  it("takes the release of a press it took, without handing it to the page", () => {
    // A guest given half a chord sees a key go up that it never saw go down,
    // and a page tracking modifiers of its own is left holding one that is not
    // held any more.
    const host = hosting();
    host.press();
    const given = host.press({ type: "keyUp" });

    expect(host.page.sent).toStrictEqual([
      [CHROME_SHORTCUT_CHANNEL, ALT_ENTER],
    ]);
    expect(given).toBe(false);
  });

  it("takes that release however the chord came apart", () => {
    // A user lets go of Alt before Enter as often as the other way round, and
    // the release that arrives then is not the combination any more — it is
    // Enter on its own. Matching it against the claim would hand the guest the
    // half of the chord this exists to keep from it.
    const host = hosting();
    host.press();
    const given = host.press({ alt: false, type: "keyUp" });

    expect(given).toBe(false);
  });

  it("takes that release when the key was renamed by the modifier coming off", () => {
    // A printable key is named for the character it produced, so Alt+Shift+T
    // goes down as `T` and comes up as `t` once Shift is off. The keyboard's
    // own name for the key — Electron's `code` — is the same throughout.
    const host = hosting();
    host.press({ code: "KeyT", key: "T", shift: true });
    const given = host.press({
      code: "KeyT",
      key: "t",
      shift: false,
      type: "keyUp",
    });

    expect(given).toBe(false);
  });

  it("leaves a release whose press it never took", () => {
    // The page can claim a combination while that combination is held, and the
    // guest is owed the release of a press it was given.
    const host = hosting({ claimFirst: false });
    const given = host.press({ type: "keyUp" });

    expect(given).toBe(true);
  });

  it("takes a repeat without opening a window for it", () => {
    // A key held down repeats tens of times a second, and a launcher that
    // answered every one of them would open a window for each. The compositor
    // never sees these at all: Wayland leaves the repeating to the client.
    const host = hosting();
    const given = host.press({ isAutoRepeat: true });

    expect(host.page.sent).toStrictEqual([]);
    expect(given).toBe(false);
  });

  it("leaves a key nobody claimed to the guest", () => {
    const host = hosting();
    const given = host.press({ code: "KeyA", key: "a" });

    expect(host.page.sent).toStrictEqual([]);
    expect(given).toBe(true);
  });

  it("leaves the same key without the modifier to the guest", () => {
    // Enter has to keep working in a page's own text field.
    const host = hosting();
    const given = host.press({ alt: false });

    expect(host.page.sent).toStrictEqual([]);
    expect(given).toBe(true);
  });

  it("treats an extra modifier as a different combination", () => {
    // Alt+Shift+Enter is its own chord — the shell claims it for a browser
    // window — so a claim on one must not answer the other.
    const host = hosting();
    const given = host.press({ shift: true });

    expect(host.page.sent).toStrictEqual([]);
    expect(given).toBe(true);
  });

  it("takes a chord from a guest that attached before the page claimed it", () => {
    // The page claims on mount and its windows are embedded afterwards, but
    // nothing in the host orders the two: a claim is the set of chords, not
    // something a guest is wired with when it arrives.
    const host = hosting({ claimFirst: false });
    const given = host.press();

    expect(host.page.sent).toStrictEqual([
      [CHROME_SHORTCUT_CHANNEL, ALT_ENTER],
    ]);
    expect(given).toBe(false);
  });

  it("ignores a claim made by some other window's page", () => {
    // `ipcMain` is the whole process's, so every window's claims arrive at
    // every window's listener. A desktop is one window today; a claim that is
    // not this page's belongs to the wiring that is not this one.
    const host = hosting({ claimedByAnotherWindow: true });
    const given = host.press();

    expect(host.page.sent).toStrictEqual([]);
    expect(given).toBe(true);
  });

  it("stops listening for claims once the window is gone", () => {
    // Otherwise the listener and everything it claimed outlive the page they
    // were for, and a shell that opened a second window would accumulate one
    // of each per window.
    const host = hosting();
    host.destroy();

    expect(host.listening()).toBe(0);
  });
});

/**
 * The host wired to a window whose page has claimed Alt+Enter, with a guest
 * embedded in it.
 *
 * `press` returns whether the guest was given the key — what a real one reads
 * off `event.preventDefault` not having been called.
 */
const hosting = ({
  claimFirst = true,
  claimedByAnotherWindow = false,
}: {
  claimFirst?: boolean;
  claimedByAnotherWindow?: boolean;
} = {}) => {
  const page = fakePage();
  const ipc = fakeIpc();
  takeGuestShortcuts(page, ipc);
  const guest = fakeGuest();
  const claimant = claimedByAnotherWindow ? "another window's page" : page;
  const claim = (): void => {
    ipc.claim(ALT_ENTER, claimant);
    ipc.claim(ALT_SHIFT_T, claimant);
  };
  if (claimFirst) {
    claim();
    page.attach(guest);
  } else {
    page.attach(guest);
    claim();
  }
  return {
    destroy: () => {
      page.destroy();
    },
    listening: () => ipc.listening(),
    page,
    press: (over: Record<string, unknown> = {}) => {
      const event = guestEvent();
      guest.press(event, press(over));
      return !event.prevented;
    },
  };
};

// The window's own page: where claims come from, and where a claimed press
// goes back to. Every subscription is checked by name, because the names are
// most of what this wiring is.
const fakePage = () => {
  const page = {
    attach: (_guest: unknown): void => {
      throw new Error("nothing listened for did-attach-webview");
    },
    destroy: (): void => {
      throw new Error("nothing listened for the window going away");
    },
    on: (event: string, listener: (event: unknown, guest: never) => void) => {
      if (event !== "did-attach-webview") {
        throw new Error(`the page was subscribed to ${event}`);
      }
      page.attach = (guest: unknown) => {
        listener(undefined, guest as never);
      };
    },
    once: (event: string, listener: () => void) => {
      if (event !== "destroyed") {
        throw new Error(`the page was waited on for ${event}`);
      }
      page.destroy = listener;
    },
    send: (channel: string, chord: Chord) => {
      page.sent.push([channel, chord]);
    },
    sent: [] as [string, Chord][],
  };
  return page;
};

// Electron's main-process IPC, which is the whole process's rather than one
// window's — so `claim` says which page a claim came from.
const fakeIpc = () => {
  const claims = new Set<(event: { sender: unknown }, chord: Chord) => void>();
  const named = (channel: string): void => {
    if (channel !== CHROME_GRAB_SHORTCUT_CHANNEL) {
      throw new Error(`a claim was expected on ${channel}`);
    }
  };
  return {
    claim: (chord: Chord, sender: unknown) => {
      for (const listener of claims) {
        listener({ sender }, chord);
      }
    },
    listening: () => claims.size,
    off: (
      channel: string,
      listener: (event: { sender: unknown }, chord: Chord) => void,
    ) => {
      named(channel);
      claims.delete(listener);
    },
    on: (
      channel: string,
      listener: (event: { sender: unknown }, chord: Chord) => void,
    ) => {
      named(channel);
      claims.add(listener);
    },
  };
};

// A `<webview>`'s browsing context, whose keys the host is given first.
const fakeGuest = () => {
  const guest = {
    on: (event: string, listener: (event: never, key: never) => void) => {
      if (event !== "before-input-event") {
        throw new Error(`the guest was subscribed to ${event}`);
      }
      guest.press = (pressed: unknown, key: unknown) => {
        listener(pressed as never, key as never);
      };
    },
    press: (_event: unknown, _key: unknown): void => {
      throw new Error("nothing listened for before-input-event");
    },
  };
  return guest;
};

// What `before-input-event` hands its listener: the guest is given the key
// unless the listener says otherwise.
const guestEvent = () => {
  const event = {
    preventDefault: () => {
      event.prevented = true;
    },
    prevented: false,
  };
  return event;
};
