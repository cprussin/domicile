import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "./fake-host";
import { fireGlobalShortcuts } from "./global-shortcuts";

const TALK = { app_id: "org.example.App", chord: "Ctrl+Alt+t", id: 3 };

/** Push the chords applications hold, as the compositor does. */
const bind = (fake: FakeDomicileHost, shortcuts: readonly object[]) => {
  fake.dispatch("portalrequests", {
    data: JSON.stringify({ items: [], shortcuts, type: "portal_requests" }),
  });
};

const press = (fake: FakeDomicileHost, chord: string) => {
  fake.dispatch("shortcut", { chord });
};

const release = (fake: FakeDomicileHost, chord: string) => {
  fake.dispatch("shortcutrelease", { chord });
};

const recorded = (fake: FakeDomicileHost, name: string) =>
  fake.calls.filter(([called]) => called === name).map(([, ...args]) => args);

describe("fireGlobalShortcuts", () => {
  it("grabs each bound chord once and reports a press under its id", () => {
    const fake = new FakeDomicileHost();
    fireGlobalShortcuts(fake.host);
    bind(fake, [TALK]);
    bind(fake, [TALK, { ...TALK, chord: "Ctrl+Alt+m", id: 4 }]);

    press(fake, "Ctrl+Alt+m");
    press(fake, "Meta+Return");

    expect(recorded(fake, "grabShortcut")).toEqual([
      ["Ctrl+Alt+t"],
      ["Ctrl+Alt+m"],
    ]);
    expect(recorded(fake, "answerPortalRequest")).toEqual([
      [4, JSON.stringify({ kind: "pressed" })],
    ]);
  });

  it("reports a release under its id", () => {
    const fake = new FakeDomicileHost();
    fireGlobalShortcuts(fake.host);
    bind(fake, [TALK]);

    press(fake, "Ctrl+Alt+t");
    release(fake, "Ctrl+Alt+t");

    expect(recorded(fake, "answerPortalRequest")).toEqual([
      [3, JSON.stringify({ kind: "pressed" })],
      [3, JSON.stringify({ kind: "released" })],
    ]);
  });

  it("reports nothing for a chord no longer bound", () => {
    const fake = new FakeDomicileHost();
    fireGlobalShortcuts(fake.host);
    bind(fake, [TALK]);
    bind(fake, []);

    press(fake, "Ctrl+Alt+t");

    expect(recorded(fake, "answerPortalRequest")).toEqual([]);
  });

  it("stops when the returned function is called", () => {
    const fake = new FakeDomicileHost();
    const stop = fireGlobalShortcuts(fake.host);
    bind(fake, [TALK]);
    stop();

    press(fake, "Ctrl+Alt+t");
    release(fake, "Ctrl+Alt+t");

    expect(recorded(fake, "answerPortalRequest")).toEqual([]);
  });
});
