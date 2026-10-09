import { describe, expect, it } from "bun:test";

import { PROTOCOL_VERSION, parseHostMessage } from "./protocol";

describe("parseHostMessage", () => {
  it("decodes a welcome frame", () => {
    expect(
      parseHostMessage(
        `{"type":"welcome","protocol_version":${PROTOCOL_VERSION.toString()}}`,
      ),
    ).toEqual({
      protocol_version: PROTOCOL_VERSION,
      type: "welcome",
    });
  });

  it("decodes a cursor frame", () => {
    expect(
      parseHostMessage('{"type":"app_cursor","app_id":"term","cursor":"text"}'),
    ).toEqual({
      app_id: "term",
      cursor: "text",
      type: "app_cursor",
    });
  });

  it("decodes what a search found", () => {
    expect(
      parseHostMessage(
        '{"type":"found_files","query":"src","files":["src/"],"matched":1,"indexing":true}',
      ),
    ).toEqual({
      files: ["src/"],
      indexing: true,
      matched: 1,
      query: "src",
      type: "found_files",
    });
  });

  it("throws on a cursor that is not a CSS keyword the chrome knows", () => {
    expect(() =>
      parseHostMessage(
        '{"type":"app_cursor","app_id":"term","cursor":"wiggle"}',
      ),
    ).toThrow();
  });

  it("normalizes a missing app title to undefined", () => {
    const message = parseHostMessage(
      '{"type":"app_appeared","app_id":"term","title":null,"size":[640,480]}',
    );
    expect(message).toEqual({
      app_id: "term",
      desktop_id: undefined,
      size: [640, 480],
      title: undefined,
      type: "app_appeared",
    });
  });

  it("normalizes the size of a client that has not committed to undefined", () => {
    // A window has no size until it draws; the host sends `null` and the
    // size follows in `app_resized`. The desktop id follows in
    // `app_desktop_id`.
    const message = parseHostMessage(
      '{"type":"app_appeared","app_id":"term","title":null,"desktop_id":null,"size":null}',
    );
    expect(message).toStrictEqual({
      app_id: "term",
      desktop_id: undefined,
      size: undefined,
      title: undefined,
      type: "app_appeared",
    });
  });

  it("decodes which desktop entry a client says it is", () => {
    expect(
      parseHostMessage(
        '{"type":"app_desktop_id","app_id":"term","desktop_id":"kitty"}',
      ),
    ).toStrictEqual({
      app_id: "term",
      desktop_id: "kitty",
      type: "app_desktop_id",
    });
  });

  it("decodes what a client calls its window", () => {
    // The title arrives after `app_appeared`, and again on each change.
    expect(
      parseHostMessage(
        '{"type":"app_titled","app_id":"term","title":"a terminal"}',
      ),
    ).toStrictEqual({
      app_id: "term",
      title: "a terminal",
      type: "app_titled",
    });
  });

  it("reads a client that named its window nothing as having no name", () => {
    // xdg-shell cannot clear a title, so clients send `set_title("")`.
    expect(
      parseHostMessage('{"type":"app_titled","app_id":"term","title":""}'),
    ).toStrictEqual({ app_id: "term", title: undefined, type: "app_titled" });
  });

  it("keeps unknown fields so a newer host can add them", () => {
    const message = parseHostMessage(
      '{"type":"app_closed","app_id":"term","reason":"crashed"}',
    );
    expect(message).toMatchObject({ app_id: "term", type: "app_closed" });
  });

  it("reports an unknown message type as undefined rather than throwing", () => {
    expect(parseHostMessage('{"type":"who_knows","data":1}')).toBeUndefined();
  });

  it("throws on a frame that is not JSON", () => {
    expect(() => parseHostMessage("not json")).toThrow();
  });

  it("throws when a known message type has the wrong payload", () => {
    expect(() =>
      parseHostMessage('{"type":"app_resized","app_id":"term"}'),
    ).toThrow();
  });

  it("decodes who holds the keyboard, both ways round", () => {
    // `null` means the chrome has focus.
    expect(
      parseHostMessage(
        JSON.stringify({ app_id: "app-1", type: "focus_changed" }),
      ),
    ).toStrictEqual({ app_id: "app-1", type: "focus_changed" });

    expect(
      parseHostMessage(JSON.stringify({ app_id: null, type: "focus_changed" })),
    ).toStrictEqual({ app_id: undefined, type: "focus_changed" });
  });

  it("decodes whether anybody is at the desk, both ways round", () => {
    // Sent as a state, not an edge, so a reloaded page learns the current
    // value. Both values must decode.
    expect(
      parseHostMessage(JSON.stringify({ idle: true, type: "idle" })),
    ).toStrictEqual({ idle: true, type: "idle" });

    expect(
      parseHostMessage(JSON.stringify({ idle: false, type: "idle" })),
    ).toStrictEqual({ idle: false, type: "idle" });
  });

  it("decodes whether the desk is locked, both ways round", () => {
    // A reloaded page must learn the desk is still locked. An inverted value
    // would hide the lock screen while locked.
    expect(
      parseHostMessage(JSON.stringify({ locked: true, type: "locked" })),
    ).toStrictEqual({ locked: true, type: "locked" });

    expect(
      parseHostMessage(JSON.stringify({ locked: false, type: "locked" })),
    ).toStrictEqual({ locked: false, type: "locked" });
  });

  it("decodes the desktop's displays", () => {
    // One page spans every display; `position` places each `<Screen>`.
    expect(
      parseHostMessage(
        JSON.stringify({
          displays: [
            {
              mode: [1920, 1080],
              name: "left",
              position: [0, 0],
              scale: 1,
              size: [1920, 1080],
              transform: "normal",
            },
            {
              mode: [5120, 2880],
              name: "right",
              position: [1920, 0],
              scale: 2,
              size: [2560, 1440],
              transform: "normal",
            },
          ],
          type: "displays",
        }),
      ),
    ).toStrictEqual({
      displays: [
        {
          mode: [1920, 1080],
          name: "left",
          position: [0, 0],
          scale: 1,
          size: [1920, 1080],
          transform: "normal",
        },
        {
          mode: [5120, 2880],
          name: "right",
          position: [1920, 0],
          scale: 2,
          size: [2560, 1440],
          transform: "normal",
        },
      ],
      type: "displays",
    });
  });

  it("decodes a monitor on its side", () => {
    // `size`, `mode` and `transform` are independent: `scale` is the integer
    // `wl_output` scale, so `size` times `scale` need not equal `mode`.
    expect(
      parseHostMessage(
        JSON.stringify({
          displays: [
            {
              mode: [3840, 2160],
              name: "drm-3",
              position: [0, 0],
              scale: 2,
              size: [1800, 3200],
              transform: "rotate-270",
            },
          ],
          type: "displays",
        }),
      ),
    ).toStrictEqual({
      displays: [
        {
          mode: [3840, 2160],
          name: "drm-3",
          position: [0, 0],
          scale: 2,
          size: [1800, 3200],
          transform: "rotate-270",
        },
      ],
      type: "displays",
    });
  });

  it("decodes a display from before any of it was turned or scanned out", () => {
    // Captured or hand-written frames may omit `mode` and `transform`. They
    // default to `[0, 0]` (unknown) and `normal`.
    expect(
      parseHostMessage(
        JSON.stringify({
          displays: [
            { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
          ],
          type: "displays",
        }),
      ),
    ).toStrictEqual({
      displays: [
        {
          mode: [0, 0],
          name: "left",
          position: [0, 0],
          scale: 1,
          size: [1920, 1080],
          transform: "normal",
        },
      ],
      type: "displays",
    });
  });

  it("decodes a desktop of no displays as an empty one, not a missing one", () => {
    // The compositor never sends this, but it must still decode as a valid
    // (empty) layout.
    expect(
      parseHostMessage(JSON.stringify({ displays: [], type: "displays" })),
    ).toStrictEqual({ displays: [], type: "displays" });
  });

  // `looseObject` accepts unknown keys, so only rejections prove the schema
  // validates.
  it.each([
    ["a position of one number", { position: [0] }],
    ["a fractional position", { position: [0.5, 0] }],
    ["a fractional position in its other half", { position: [0, 0.5] }],
    ["a size of one number", { size: [1920] }],
    ["a fractional size", { size: [1920.5, 1080] }],
    ["a fractional size in its other half", { size: [1920, 1080.5] }],
    ["a name that is not anything", { name: "" }],
    ["a size with no pixels", { size: [0, 1080] }],
    ["a negative size", { size: [1920, -1080] }],
    ["a fractional scale", { scale: 1.5 }],
    ["a scale of nothing", { scale: 0 }],
    ["a name that is not one", { name: 7 }],
    ["no name at all", { name: undefined }],
    ["no position at all", { position: undefined }],
    ["no size at all", { size: undefined }],
    ["no scale at all", { scale: undefined }],
  ])("throws on a display with %s", (_what, broken) => {
    const display = {
      name: "left",
      position: [0, 0],
      scale: 1,
      size: [1920, 1080],
      ...broken,
    };
    expect(() =>
      parseHostMessage(
        JSON.stringify({ displays: [display], type: "displays" }),
      ),
    ).toThrow();
  });

  it("throws when the desktop itself is missing from the message", () => {
    // A missing list must not decode as an empty one.
    expect(() => parseHostMessage('{"type":"displays"}')).toThrow();
  });

  it("throws on a display that describes nothing at all", () => {
    expect(() =>
      parseHostMessage(JSON.stringify({ displays: [{}], type: "displays" })),
    ).toThrow();
  });

  it("knows no message the compositor does not send", () => {
    // The engine matches shortcuts itself, and a shell previews a file with
    // its system calls.
    expect(
      parseHostMessage(
        JSON.stringify({
          shortcut: {
            alt: true,
            ctrl: false,
            key: 28,
            logo: false,
            shift: false,
          },
          type: "shortcut",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseHostMessage(
        JSON.stringify({ kind: "binary", path: "a", type: "file_preview" }),
      ),
    ).toBeUndefined();
  });

  it("decodes the tray, with the bus each icon answers on", () => {
    const icon = { bus: ":1.42", id: "nm", menu: "/MenuBar", title: "Network" };

    expect(
      parseHostMessage(JSON.stringify({ items: [icon], type: "tray" })),
    ).toStrictEqual({ items: [icon], type: "tray" });
    expect(() =>
      parseHostMessage(
        JSON.stringify({
          items: [{ id: "nm", title: "Network" }],
          type: "tray",
        }),
      ),
    ).toThrow();
  });

  it("decodes the keyboard: every keysym and the key it is on", () => {
    expect(
      parseHostMessage(
        JSON.stringify({ keys: { l: 38, Return: 28 }, type: "shell_config" }),
      ),
    ).toStrictEqual({ keys: { l: 38, Return: 28 }, type: "shell_config" });
  });

  it("throws on a key that is not a key number", () => {
    expect(() =>
      parseHostMessage(
        JSON.stringify({ keys: { Return: -1 }, type: "shell_config" }),
      ),
    ).toThrow();
  });
});
