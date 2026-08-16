import { describe, expect, it } from "bun:test";

import {
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  placePortalMessage,
  removePortalMessage,
  spawnMessage,
} from "./chrome-message";

describe("placePortalMessage", () => {
  it("matches the domicile-protocol wire shape", () => {
    expect(
      placePortalMessage({
        appId: "term",
        size: [10, 20],
        transform: [1, 0, 0, 1, 5, 6],
        visible: true,
        zIndex: 3,
      }),
    ).toEqual({
      app_id: "term",
      size: [10, 20],
      transform: [1, 0, 0, 1, 5, 6],
      type: "place_portal",
      visible: true,
      z_index: 3,
    });
  });

  it("defaults z_index to 0 and visible to true", () => {
    const message = placePortalMessage({
      appId: "term",
      size: [1, 1],
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(message.z_index).toBe(0);
    expect(message.visible).toBe(true);
  });

  it("rejects an empty app id", () => {
    expect(() => {
      placePortalMessage({
        appId: "",
        size: [1, 1],
        transform: [1, 0, 0, 1, 0, 0],
      });
    }).toThrow(TypeError);
  });
});

describe("spawnMessage", () => {
  it("carries the full argv", () => {
    expect(spawnMessage(["kitty", "--hold"])).toEqual({
      command: ["kitty", "--hold"],
      type: "spawn",
    });
  });

  it("rejects an empty argv", () => {
    expect(() => spawnMessage([])).toThrow(TypeError);
  });
});

describe("the remaining chrome->host messages", () => {
  it("match the domicile-protocol wire shape", () => {
    expect(removePortalMessage("term")).toEqual({
      app_id: "term",
      type: "remove_portal",
    });
    expect(focusAppMessage("term")).toEqual({
      app_id: "term",
      type: "focus_app",
    });
    expect(focusChromeMessage()).toEqual({ type: "focus_chrome" });
    expect(helloMessage(1)).toEqual({ protocol_version: 1, type: "hello" });
  });
});
