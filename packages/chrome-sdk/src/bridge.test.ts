import { beforeEach, describe, expect, it } from "bun:test";
import type { Transport } from "./bridge";
import { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";

// A fake transport: records outgoing JSON and lets the test push incoming.
class FakeTransport implements Transport {
  readonly sent: unknown[] = [];

  #onMessage:
    | ((text: string, pixels?: Uint8Array<ArrayBuffer>) => void)
    | undefined;

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  onMessage(
    callback: (text: string, pixels?: Uint8Array<ArrayBuffer>) => void,
  ): void {
    this.#onMessage = callback;
  }

  /** Simulate a message arriving from the host. */
  push(message: unknown, pixels?: Uint8Array<ArrayBuffer>): void {
    this.#onMessage?.(JSON.stringify(message), pixels);
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

  it("sends hello on connect and resolves on welcome", async () => {
    const connected = bridge.connect();
    expect(transport.sent[0]).toEqual({ protocol_version: 1, type: "hello" });
    transport.push({ protocol_version: 1, type: "welcome" });
    expect(await connected).toBe(1);
  });

  it("rejects connect on a version mismatch", async () => {
    const connected = bridge.connect();
    transport.push({ protocol_version: 2, type: "welcome" });
    await expect(connected).rejects.toThrow(/version/i);
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
      opacity: 1,
      shadow: null,
      size: [10, 20],
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

      expect(timed.roundTrip.take()).toEqual({
        averageMs: 120,
        count: 1,
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

      expect(timed.roundTrip.take()).toBeUndefined();
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

      expect(timed.roundTrip.take()?.worstMs).toBe(50);
    });
  });
});
