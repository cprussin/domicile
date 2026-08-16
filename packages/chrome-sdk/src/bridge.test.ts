import { beforeEach, describe, expect, it } from "bun:test";
import type { Transport } from "./bridge";
import { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";

// A fake transport: records outgoing JSON and lets the test push incoming.
class FakeTransport implements Transport {
  readonly sent: unknown[] = [];

  #onMessage: ((text: string) => void) | undefined;

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  onMessage(callback: (text: string) => void): void {
    this.#onMessage = callback;
  }

  /** Simulate a message arriving from the host. */
  push(message: unknown): void {
    this.#onMessage?.(JSON.stringify(message));
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
});
