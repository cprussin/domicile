import { describe, it, expect, beforeEach } from "vitest";
import { BridgeClient } from "../src/bridge.js";

// A fake transport: records outgoing JSON and lets the test push incoming.
class FakeTransport {
  constructor() {
    this.sent = [];
    this._onMessage = null;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  onMessage(cb) {
    this._onMessage = cb;
  }
  // test helper: simulate a message arriving from the host
  push(msg) {
    this._onMessage(JSON.stringify(msg));
  }
  lastSent() {
    return this.sent[this.sent.length - 1];
  }
}

describe("BridgeClient", () => {
  let transport;
  let bridge;

  beforeEach(() => {
    transport = new FakeTransport();
    bridge = new BridgeClient(transport, { protocolVersion: 1 });
  });

  it("sends hello on connect and resolves on welcome", async () => {
    const connected = bridge.connect();
    expect(transport.sent[0]).toEqual({ type: "hello", protocol_version: 1 });
    transport.push({ type: "welcome", protocol_version: 1 });
    await expect(connected).resolves.toBe(1);
  });

  it("rejects connect on a version mismatch", async () => {
    const connected = bridge.connect();
    transport.push({ type: "welcome", protocol_version: 2 });
    await expect(connected).rejects.toThrow(/version/i);
  });

  it("dispatches host messages to registered handlers", async () => {
    const seen = [];
    bridge.on("app_appeared", (m) => seen.push(m));
    bridge.connect();
    transport.push({ type: "welcome", protocol_version: 1 });

    transport.push({ type: "app_appeared", app_id: "term", title: "Terminal", size: [640, 480] });
    expect(seen).toHaveLength(1);
    expect(seen[0].app_id).toBe("term");
    expect(seen[0].size).toEqual([640, 480]);
  });

  it("send helpers emit correctly-shaped messages", async () => {
    bridge.connect();
    transport.push({ type: "welcome", protocol_version: 1 });

    bridge.placePortal({ appId: "term", size: [10, 20], transform: [1, 0, 0, 1, 0, 0], zIndex: 2 });
    expect(transport.lastSent()).toEqual({
      type: "place_portal",
      app_id: "term",
      transform: [1, 0, 0, 1, 0, 0],
      size: [10, 20],
      z_index: 2,
      visible: true,
    });

    bridge.removePortal("term");
    expect(transport.lastSent()).toEqual({ type: "remove_portal", app_id: "term" });

    bridge.focusApp("term");
    expect(transport.lastSent()).toEqual({ type: "focus_app", app_id: "term" });

    bridge.spawn(["kitty"]);
    expect(transport.lastSent()).toEqual({ type: "spawn", command: ["kitty"] });
  });

  it("ignores unknown host message types without throwing", () => {
    bridge.connect();
    transport.push({ type: "welcome", protocol_version: 1 });
    expect(() => transport.push({ type: "who_knows", data: 1 })).not.toThrow();
  });
});
