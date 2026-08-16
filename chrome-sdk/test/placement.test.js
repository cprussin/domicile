import { describe, it, expect } from "vitest";
import {
  placePortalMessage,
  removePortalMessage,
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  spawnMessage,
} from "../src/placement.js";

describe("placement messages", () => {
  it("place_portal matches the dm-protocol wire shape", () => {
    const msg = placePortalMessage({
      appId: "term",
      size: [10, 20],
      transform: [1, 0, 0, 1, 5, 6],
      zIndex: 3,
      visible: true,
    });
    expect(msg).toEqual({
      type: "place_portal",
      app_id: "term",
      transform: [1, 0, 0, 1, 5, 6],
      size: [10, 20],
      z_index: 3,
      visible: true,
    });
  });

  it("place_portal defaults z_index to 0 and visible to true", () => {
    const msg = placePortalMessage({
      appId: "term",
      size: [1, 1],
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(msg.z_index).toBe(0);
    expect(msg.visible).toBe(true);
  });

  it("place_portal rejects malformed geometry", () => {
    expect(() => placePortalMessage({ appId: "x", size: [1], transform: [1, 0, 0, 1, 0, 0] })).toThrow();
    expect(() => placePortalMessage({ appId: "x", size: [1, 1], transform: [1, 0] })).toThrow();
    expect(() => placePortalMessage({ appId: "", size: [1, 1], transform: [1, 0, 0, 1, 0, 0] })).toThrow();
  });

  it("builds the other chrome->host messages", () => {
    expect(removePortalMessage("term")).toEqual({ type: "remove_portal", app_id: "term" });
    expect(focusAppMessage("term")).toEqual({ type: "focus_app", app_id: "term" });
    expect(focusChromeMessage()).toEqual({ type: "focus_chrome" });
    expect(helloMessage(1)).toEqual({ type: "hello", protocol_version: 1 });
  });

  it("builds and validates spawn messages", () => {
    expect(spawnMessage(["kitty"])).toEqual({ type: "spawn", command: ["kitty"] });
    expect(spawnMessage(["kitty", "--hold"]).command).toEqual(["kitty", "--hold"]);
    expect(() => spawnMessage([])).toThrow();
    expect(() => spawnMessage("kitty")).toThrow();
  });
});
