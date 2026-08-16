import { describe, expect, it } from "bun:test";

import {
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  placePortalMessage,
  pointerAxisMessage,
  removePortalMessage,
  resizeAppMessage,
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

describe("resizeAppMessage", () => {
  it("matches the domicile-protocol wire shape", () => {
    expect(resizeAppMessage("term", [800, 600])).toEqual({
      app_id: "term",
      size: [800, 600],
      type: "resize_app",
    });
  });

  it("rejects an empty app id", () => {
    expect(() => resizeAppMessage("", [1, 1])).toThrow(TypeError);
  });
});

describe("pointerAxisMessage", () => {
  it("carries both the continuous and the discrete scroll", () => {
    expect(
      pointerAxisMessage("term", { dx: 0, dy: -100, v120X: 0, v120Y: -120 }),
    ).toEqual({
      app_id: "term",
      dx: 0,
      dy: -100,
      type: "pointer_axis",
      v120_x: 0,
      v120_y: -120,
    });
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
    expect(helloMessage(2)).toEqual({ protocol_version: 2, type: "hello" });
  });
});
