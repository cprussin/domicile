import { beforeEach, describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { Transport } from "./bridge";

import {
  BridgeClient,
  describeHandshakeFailure,
  HandshakeFailure,
} from "./bridge";
import { BTN_LEFT } from "./input";
import type { DisplayInfo } from "./protocol";

// A fake transport: records outgoing JSON and lets the test push incoming.
class FakeTransport implements Transport {
  readonly sent: unknown[] = [];

  #onMessage:
    | ((
        text: string,
        pixels?: Uint8Array<ArrayBuffer>,
        sentAt?: number,
      ) => void)
    | undefined;

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  onMessage(
    callback: (
      text: string,
      pixels?: Uint8Array<ArrayBuffer>,
      sentAt?: number,
    ) => void,
  ): void {
    this.#onMessage = callback;
  }

  /** Simulate a message arriving from the host. */
  push(
    message: unknown,
    pixels?: Uint8Array<ArrayBuffer>,
    sentAt?: number,
  ): void {
    this.#onMessage?.(JSON.stringify(message), pixels, sentAt);
  }

  lastSent(): unknown {
    return this.sent.at(-1);
  }
}

describe("BridgeClient", () => {
  let transport: FakeTransport;
  let bridge: BridgeClient;

  beforeEach(() => {
    transport = new FakeTransport();
    bridge = new BridgeClient(transport, { protocolVersion: 1 });
  });

  it("sends hello on connect and agrees on welcome", async () => {
    const connected = bridge.connect();
    expect(transport.sent[0]).toEqual({ protocol_version: 1, type: "hello" });
    transport.push({ protocol_version: 1, type: "welcome" });
    expect(await connected).toStrictEqual(Ok(1));
  });

  it("reports a version mismatch as a value rather than a rejection", async () => {
    // The handshake crosses a process boundary, and the two halves
    // disagreeing is an outcome the caller has to decide about — not a bug to
    // throw at it. Rejecting made the shell's only recourse a `.catch` that
    // rethrew inside a promise handler, which is an unhandled rejection rather
    // than a desktop saying why it will not start.
    const connected = bridge.connect();
    transport.push({ protocol_version: 2, type: "welcome" });

    expect(await connected).toStrictEqual(
      Err(HandshakeFailure.VersionMismatch({ chrome: 1, host: 2 })),
    );
  });

  it("names both versions when the halves disagree", () => {
    // The wording is the whole point of reporting rather than throwing — a
    // desktop that will not start should say what it disagreed about. Nothing
    // else pins it, and `describeHandshakeFailure` could be gutted to `""`
    // with the rest of this file still green.
    expect(
      describeHandshakeFailure(
        HandshakeFailure.VersionMismatch({ chrome: 1, host: 2 }),
      ),
    ).toBe("protocol version mismatch: chrome speaks 1, host speaks 2");
  });

  it("dispatches host messages to registered handlers", () => {
    const seen: { app_id: string }[] = [];
    bridge.on("app_appeared", (message) => {
      seen.push(message);
    });
    transport.push({
      app_id: "term",
      size: [640, 480],
      title: "Terminal",
      type: "app_appeared",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.app_id).toBe("term");
  });

  it("holds a message that arrives before its handler registers", () => {
    // The host starts talking the moment the socket opens: `connect()` is
    // answered with a `welcome` and one `app_appeared` per client already
    // running. A React page registers its handlers in its first effect flush,
    // tens of milliseconds later — always after, never before, because
    // rendering only schedules the effect. Dropping what lands in that window
    // is a live client with no window on screen, and no second chance: nothing
    // ever says `app_appeared` again for that client.
    transport.push({
      app_id: "term",
      size: [640, 480],
      title: "Terminal",
      type: "app_appeared",
    });
    transport.push({
      app_id: "editor",
      size: [800, 600],
      title: "Editor",
      type: "app_appeared",
    });

    const seen: { app_id: string }[] = [];
    bridge.on("app_appeared", (message) => {
      seen.push(message);
    });

    expect(seen.map((message) => message.app_id)).toEqual(["term", "editor"]);
  });

  it("does not replay a held message to a handler that replaces another", () => {
    // The flush empties the hold. Without that, every later `on` for the same
    // type would mount the same windows again.
    transport.push({
      app_id: "term",
      size: [640, 480],
      title: "Terminal",
      type: "app_appeared",
    });
    bridge.on("app_appeared", () => {
      // The first handler takes the held message; this test is about the
      // second one.
    });

    const seen: string[] = [];
    bridge.on("app_appeared", (message) => {
      seen.push(message.app_id);
    });

    expect(seen).toEqual([]);
  });

  it("holds only the type that has no handler", () => {
    // One hold per type, not one queue for everything: a page that registers
    // `app_appeared` must not be handed the `app_closed` it has no handler
    // for yet.
    const seen: string[] = [];
    transport.push({ app_id: "term", type: "app_closed" });
    transport.push({
      app_id: "term",
      size: [640, 480],
      title: "Terminal",
      type: "app_appeared",
    });

    bridge.on("app_appeared", (message) => {
      seen.push(`appeared:${message.app_id}`);
    });
    expect(seen).toEqual(["appeared:term"]);

    bridge.on("app_closed", (message) => {
      seen.push(`closed:${message.app_id}`);
    });
    expect(seen).toEqual(["appeared:term", "closed:term"]);
  });

  it("send helpers emit correctly-shaped messages", () => {
    bridge.placePortal({
      appId: "term",
      size: [10, 20],
      transform: [1, 0, 0, 1, 0, 0],
      zIndex: 2,
    });
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      corner_radius: 0,
      native: true,
      opacity: 1,
      shadow: null,
      size: [10, 20],
      takes_pointer: true,
      transform: [1, 0, 0, 1, 0, 0],
      type: "place_portal",
      visible: true,
      z_index: 2,
    });

    bridge.removePortal("term");
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      type: "remove_portal",
    });

    bridge.focusApp("term");
    expect(transport.lastSent()).toEqual({ app_id: "term", type: "focus_app" });

    bridge.closeApp("term");
    expect(transport.lastSent()).toEqual({ app_id: "term", type: "close_app" });

    bridge.spawn(["kitty"]);
    expect(transport.lastSent()).toEqual({ command: ["kitty"], type: "spawn" });

    bridge.pointerMotion("term", 5, 6);
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      type: "pointer_motion",
      x: 5,
      y: 6,
    });

    bridge.pointerButton("term", BTN_LEFT, true);
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      button: BTN_LEFT,
      pressed: true,
      type: "pointer_button",
    });

    bridge.resizeApp("term", [800, 600]);
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      size: [800, 600],
      type: "resize_app",
    });

    bridge.pointerAxis("term", { dx: 0, dy: 100, v120X: 0, v120Y: 120 });
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      dx: 0,
      dy: 100,
      type: "pointer_axis",
      v120_x: 0,
      v120_y: 120,
    });

    bridge.key("term", 30, true);
    expect(transport.lastSent()).toEqual({
      app_id: "term",
      keycode: 30,
      pressed: true,
      type: "key",
    });
  });

  it("ignores unknown host message types without throwing", () => {
    expect(() => {
      transport.push({ data: 1, type: "who_knows" });
    }).not.toThrow();
  });

  describe("round-trip timing", () => {
    // The bridge is the only place that sees both ends of the loop — the
    // keystroke going out and the pixels that answer it coming back — so it is
    // where the number a user calls "sluggish" can be taken.
    const frame = (appId: string): [unknown, Uint8Array<ArrayBuffer>] => [
      {
        app_id: appId,
        bytes: 4,
        format: "rgba",
        height: 1,
        scale: 1,
        type: "app_frame",
        width: 1,
      },
      new Uint8Array(4),
    ];

    it("times a keystroke to the frame that answered it", () => {
      let clock = 0;
      const timed = new BridgeClient(transport, {
        now: () => clock,
        protocolVersion: 1,
      });

      timed.key("term", 30, true);
      clock = 120;
      transport.push(...frame("term"));

      expect(timed.roundTrip.report(120)).toMatchObject({
        answered: 1,
        averageMs: 120,
        sent: 1,
        worstMs: 120,
      });
    });

    it("does not start a round trip on a key release", () => {
      // Releasing a key changes nothing on screen, so the next frame to arrive
      // is some unrelated redraw — a terminal's blinking cursor, half a second
      // later. Timing to that reports the blink interval as input latency, and
      // since every press is followed by a release it would contaminate half of
      // every sample.
      let clock = 0;
      const timed = new BridgeClient(transport, {
        now: () => clock,
        protocolVersion: 1,
      });

      timed.key("term", 30, false);
      clock = 500;
      transport.push(...frame("term"));

      expect(timed.roundTrip.report(500)).toBeUndefined();
    });

    it("takes the measurement after the frame is drawn, not before", () => {
      // The handler is what puts the pixels on the canvas, and `putImageData`
      // for a full-window frame is a real cost. A measurement taken before the
      // handler runs would leave the most suspect step out of the number.
      let clock = 0;
      const timed = new BridgeClient(transport, {
        now: () => clock,
        protocolVersion: 1,
      });
      timed.on("app_frame", () => {
        clock += 40;
      });

      timed.key("term", 30, true);
      clock = 10;
      transport.push(...frame("term"));

      expect(timed.roundTrip.report(50)?.worstMs).toBe(50);
    });
  });

  describe("the hop from the host's bytes to this page", () => {
    // Reported separately from the round trip that contains it: an
    // unattributed total says a desktop is slow without saying which half of
    // it to fix. This stage used to be Electron's IPC, at 79ms a frame.
    const frame = (appId: string): [unknown, Uint8Array<ArrayBuffer>] => [
      {
        app_id: appId,
        bytes: 4,
        format: "rgba",
        height: 1,
        scale: 1,
        type: "app_frame",
        width: 1,
      },
      new Uint8Array(4),
    ];

    it("prices a message against the moment its bytes arrived", () => {
      let clock = 0;
      const timed = new BridgeClient(transport, {
        now: () => clock,
        protocolVersion: 1,
      });

      clock = 12;
      transport.push(...frame("term"), 4);

      expect(timed.hop.take()).toStrictEqual({
        averageMs: 8,
        count: 1,
        worstMs: 8,
      });
    });

    it("records nothing for a transport that never says", () => {
      // A transport with no such moment — the no-op the shell falls back to in
      // a plain browser — must not be charged one. `undefined` is the honest
      // return; what a reporter renders it as is the reporter's business.
      const timed = new BridgeClient(transport, { protocolVersion: 1 });

      transport.push(...frame("term"));

      expect(timed.hop.take()).toBeUndefined();
    });
  });

  describe("letting a handler go", () => {
    it("stops delivering to a handler that has been taken off", () => {
      // A page that unmounts the thing that registered has to be able to say
      // so. Without it the handler outlives its tree and is called into
      // whatever is left of it.
      const seen: unknown[] = [];
      const handler = (message: { app_id: string }) =>
        seen.push(message.app_id);
      bridge.on("app_closed", handler);
      bridge.off("app_closed", handler);
      transport.push({ app_id: "gone", type: "app_closed" });
      expect(seen).toStrictEqual([]);
    });

    it("drops what arrives after it rather than piling it up", () => {
      // The hold is for the gap before the page has *ever* listened for a
      // type — see `#held`. An `off` says the page listened and stopped, so
      // holding again would accumulate forever with nothing to drain it, which
      // for `app_frame` is a pile of buffers the size of the screen.
      const handler = () => undefined;
      bridge.on("app_closed", handler);
      bridge.off("app_closed", handler);
      transport.push({ app_id: "gone", type: "app_closed" });

      const seen: unknown[] = [];
      bridge.on("app_closed", (message) => seen.push(message.app_id));
      expect(seen).toStrictEqual([]);
    });

    it("leaves a handler that replaced it alone", () => {
      // `on` is a single slot, so the second registration already displaced
      // the first. A teardown that ran afterwards and removed whatever it
      // found would silence the live handler on behalf of a dead one. Which
      // caller does that is not this class's business to predict: taking the
      // handler is what makes letting one go safe in any order.
      const seen: unknown[] = [];
      const first = () => seen.push("first");
      bridge.on("app_closed", first);
      bridge.on("app_closed", () => seen.push("second"));
      bridge.off("app_closed", first);
      transport.push({ app_id: "gone", type: "app_closed" });
      expect(seen).toStrictEqual(["second"]);
    });
  });

  describe("the desktop the host described", () => {
    const LEFT: DisplayInfo = {
      name: "left",
      position: [0, 0],
      scale: 1,
      size: [1920, 1080],
    };

    it("is nothing until the host says", () => {
      // Distinct from a desktop of no displays, which is an answer. A shell that
      // could not tell them apart would lay out against a screen it had not been
      // told the shape of.
      expect(bridge.displays).toBeUndefined();
    });

    it("is retained, so everything that asks gets it", () => {
      // `displays` arrives at least once per connection — and again on every
      // desktop change — and `on` hands a held message to the *first* handler
      // and then forgets it. A page with two `<Screen>`s
      // registering separately would leave the second with nothing — silently,
      // as an empty region, which is what a `<Screen>` for an absent display is
      // supposed to look like.
      transport.push({ displays: [LEFT], type: "displays" });
      expect(bridge.displays).toStrictEqual([LEFT]);
      expect(bridge.displays).toStrictEqual([LEFT]);
    });

    it("keeps an empty desktop as an empty one", () => {
      // A desktop of no screens. Not what the compositor sends — it describes
      // at least one output, and the window-following case is a display named
      // `domicile-0` rather than an absence — but it is an *answer*, so it has
      // to displace `undefined` rather than read as "not told yet".
      transport.push({ displays: [], type: "displays" });
      expect(bridge.displays).toStrictEqual([]);
    });

    it("still reaches a handler that registers late", () => {
      // The retained copy is in addition to the hold, not instead of it: a shell
      // that wants to re-render when the desktop changes registers a handler,
      // and it must not have to poll the accessor to learn about the first one.
      transport.push({ displays: [LEFT], type: "displays" });
      const seen: unknown[] = [];
      bridge.on("displays", (message) => seen.push(message.displays));
      expect(seen).toStrictEqual([[LEFT]]);
    });

    it("is already the new desktop when the handler runs", () => {
      // The accessor is set before the message is delivered, so a handler that
      // reads it sees this desktop rather than the one before it. Registering
      // *first* is what tests that: a handler that registers after the push is
      // replayed out of the hold, where the assignment has already happened
      // wherever it sits.
      let seen: readonly DisplayInfo[] | undefined;
      bridge.on("displays", () => {
        seen = bridge.displays;
      });
      transport.push({ displays: [LEFT], type: "displays" });
      expect(seen).toStrictEqual([LEFT]);
    });

    it("is the desktop the host described most recently", () => {
      // Latest wins, not first. A second `displays` is routine rather than
      // hypothetical: with no displays configured the desktop is Domicile's
      // own window, so every resize and every density change re-describes it.
      // Keeping the first would silently lay the shell out against a desktop
      // that is gone.
      const RIGHT: DisplayInfo = {
        name: "right",
        position: [1920, 0],
        scale: 2,
        size: [2560, 1440],
      };
      transport.push({ displays: [LEFT], type: "displays" });
      transport.push({ displays: [LEFT, RIGHT], type: "displays" });
      expect(bridge.displays).toStrictEqual([LEFT, RIGHT]);
    });
  });
});
