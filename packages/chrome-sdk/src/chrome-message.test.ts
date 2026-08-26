import { describe, expect, it } from "bun:test";

import {
  closeAppMessage,
  declareBandsMessage,
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  placePortalMessage,
  pointerAxisMessage,
  removePortalMessage,
  resizeAppMessage,
  spawnMessage,
} from "./chrome-message";

describe("declareBandsMessage", () => {
  it("carries the depths the chrome draws at", () => {
    expect(declareBandsMessage([0, 5, -2])).toStrictEqual({
      depths: [0, 5, -2],
      type: "declare_bands",
    });
  });

  it("copies the depths rather than holding the caller's array", () => {
    // The caller's own list, which a chrome recomputes in place every time it
    // relays out. Held rather than copied, a later mutation would change a
    // message already sent.
    const depths = [0, 5];
    const message = declareBandsMessage(depths);
    depths.push(9);

    expect(message.depths).toStrictEqual([0, 5]);
  });
});

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
      // Square and opaque unless the element says otherwise — the compositor
      // draws the window itself now, so these travel with the placement.
      corner_radius: 0,
      // And it draws it from the client's own buffer unless the element is
      // styled in a way its shaders have no answer for.
      native: true,
      opacity: 1,
      shadow: null,
      size: [10, 20],
      // And a window takes the pointer unless the element says otherwise:
      // `pointer-events: none` is the only thing that makes one inert.
      takes_pointer: true,
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

  it("sends a window down the copy path when the element asks", () => {
    // The one thing on the placement that is not a style: it says which of the
    // two paths draws this window, and the compositor draws nothing for a
    // window it has been told the engine is drawing.
    expect(
      placePortalMessage({
        appId: "term",
        native: false,
        size: [1, 1],
        transform: [1, 0, 0, 1, 0, 0],
      }).native,
    ).toBe(false);
  });

  it("keeps a window on the native path unless told otherwise", () => {
    // The fast path is the default, and a chrome written before this field
    // existed says nothing about it — so absent has to mean native, or every
    // window on such a chrome pays a readback per frame.
    expect(
      placePortalMessage({
        appId: "term",
        size: [1, 1],
        transform: [1, 0, 0, 1, 0, 0],
      }).native,
    ).toBe(true);
  });

  it("carries the shadow the element casts", () => {
    // The compositor draws it, so the numbers have to reach it — an element
    // that styles a shadow and gets none is the same bug as one that styles a
    // radius and stays square.
    const message = placePortalMessage({
      appId: "term",
      shadow: { blur: 12, color: [0, 0, 0, 0.5], dx: 4, dy: 8, spread: 2 },
      size: [1, 1],
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(message.shadow).toEqual({
      blur: 12,
      color: [0, 0, 0, 0.5],
      dx: 4,
      dy: 8,
      spread: 2,
    });
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
    expect(closeAppMessage("term")).toEqual({
      app_id: "term",
      type: "close_app",
    });
    expect(helloMessage(2)).toEqual({ protocol_version: 2, type: "hello" });
  });
});
