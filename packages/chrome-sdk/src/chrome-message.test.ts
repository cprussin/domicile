import { describe, expect, it } from "bun:test";

import {
  closeAppMessage,
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  pointerAxisMessage,
  resizeAppMessage,
  spawnMessage,
} from "./chrome-message";

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
    expect(focusAppMessage("term")).toEqual({
      app_id: "term",
      type: "focus_app",
    });
    expect(focusChromeMessage()).toEqual({ type: "focus_chrome" });
    expect(closeAppMessage("term")).toEqual({
      app_id: "term",
      type: "close_app",
    });
    expect(helloMessage(2)).toEqual({ protocol_version: 2, type: "hello" });
  });
});
