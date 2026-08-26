import { describe, expect, it } from "bun:test";

import { awaitSession } from "./await-session";

const published = JSON.stringify({
  chrome_socket: "/run/chrome.sock",
  chrome_wayland_display: "wayland-3-chrome",
  composited: false,
  protocol: 1,
  wayland_display: "wayland-3",
});

/** A `read` that says "not yet" `times` times and then hands over the document. */
const appearsAfter = (times: number): (() => Promise<string | undefined>) => {
  const remaining = { count: times };
  return () => {
    if (remaining.count > 0) {
      remaining.count -= 1;
      return Promise.resolve(undefined);
    }
    return Promise.resolve(published);
  };
};

const never = new Promise<string>(() => undefined);
const immediately = (): Promise<void> => Promise.resolve();

describe("awaitSession", () => {
  it("waits for the document to appear", async () => {
    // The compositor binds several sockets and may open a window before it
    // publishes, so the file is not there on the first look.
    const session = await awaitSession({
      delay: immediately,
      failed: never,
      read: appearsAfter(3),
    });
    expect(session.waylandDisplay).toBe("wayland-3");
  });

  it("gives up when the compositor stops first, saying what happened", async () => {
    // The failure a shell hits most: a compositor that cannot start says why
    // on stderr and exits, and a shell that waited forever would show nothing
    // at all rather than that reason.
    const attempt = awaitSession({
      delay: immediately,
      failed: Promise.resolve("it exited with status 1: no display"),
      read: () => Promise.resolve(undefined),
    });
    await expect(attempt).rejects.toThrow("no display");
  });

  it("does not take a session from a compositor that has stopped", async () => {
    // The document is already there on the very first look — a compositor that
    // publishes quickly, or a stop that arrived before the wait began — and it
    // still is not a session: whatever it managed to write, a compositor that
    // is gone cannot serve the desktop the document describes. This is the
    // ordering the wait used to get wrong, because it only asked whether there
    // was any point waiting when there had been nothing to read.
    const attempt = awaitSession({
      delay: immediately,
      failed: Promise.resolve("it was killed"),
      read: () => Promise.resolve(published),
    });
    await expect(attempt).rejects.toThrow("it was killed");
  });
});
