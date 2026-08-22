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

  it("decodes the host taking a window back", () => {
    // The counterpart to `app_frame`: the compositor is drawing this window's
    // own buffer now, so the pixels the chrome holds are a still of a live
    // window and have to go.
    expect(
      parseHostMessage('{"type":"app_composited","app_id":"term"}'),
    ).toEqual({ app_id: "term", type: "app_composited" });
  });

  it("throws on a cursor that is not a CSS keyword the chrome knows", () => {
    expect(() =>
      parseHostMessage(
        '{"type":"app_cursor","app_id":"term","cursor":"wiggle"}',
      ),
    ).toThrow();
  });

  it("normalises a missing app title to undefined", () => {
    const message = parseHostMessage(
      '{"type":"app_appeared","app_id":"term","title":null,"size":[640,480]}',
    );
    expect(message).toEqual({
      app_id: "term",
      size: [640, 480],
      title: undefined,
      type: "app_appeared",
    });
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
      parseHostMessage('{"type":"app_frame","app_id":"term"}'),
    ).toThrow();
  });

  it("decodes who holds the keyboard, both ways round", () => {
    // The one host message with a nullable field. `null` means the chrome
    // itself has the keyboard — an answer a desktop draws differently, not an
    // absence of one — and it dies here rather than in the page, the same way
    // `app_appeared`'s optional title does.
    expect(
      parseHostMessage(
        JSON.stringify({ app_id: "app-1", type: "focus_changed" }),
      ),
    ).toStrictEqual({ app_id: "app-1", type: "focus_changed" });

    expect(
      parseHostMessage(JSON.stringify({ app_id: null, type: "focus_changed" })),
    ).toStrictEqual({ app_id: undefined, type: "focus_changed" });
  });

  it("decodes the desktop's displays", () => {
    // The shell lays out against these: one page spans every display, and a
    // display is a region of it, so the position is what puts a `<Screen>`
    // over the right part of the page.
    expect(
      parseHostMessage(
        JSON.stringify({
          displays: [
            { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
            {
              name: "right",
              position: [1920, 0],
              scale: 2,
              size: [2560, 1440],
            },
          ],
          type: "displays",
        }),
      ),
    ).toStrictEqual({
      displays: [
        { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
        { name: "right", position: [1920, 0], scale: 2, size: [2560, 1440] },
      ],
      type: "displays",
    });
  });

  it("decodes a desktop of no displays as an empty one, not a missing one", () => {
    // A desktop with no screens on it, which the compositor does not send —
    // the window-following case is a display named `domicile-0` rather than an
    // empty list. The shape still has to decode: a shell that treated it as
    // absent would wait forever for a layout that had already arrived.
    expect(
      parseHostMessage(JSON.stringify({ displays: [], type: "displays" })),
    ).toStrictEqual({ displays: [], type: "displays" });
  });

  // `looseObject` passes unknown keys through, so asserting on a *valid* frame
  // cannot tell a validating schema from an empty one — only a rejection can.
  // Each of these is a frame a shell would read as a coordinate, a size or a
  // name it does not have, rather than as an error.
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
    // The chrome-side twin of the empty-list case: a `displays` frame with no
    // list at all is a host that said nothing, and it must not read as a
    // desktop of no displays — which is a real answer with a real meaning.
    expect(() => parseHostMessage('{"type":"displays"}')).toThrow();
  });

  it("throws on a display that describes nothing at all", () => {
    expect(() =>
      parseHostMessage(JSON.stringify({ displays: [{}], type: "displays" })),
    ).toThrow();
  });

  it("decodes a shortcut the compositor took for the desktop", () => {
    // It arrives as a message rather than a DOM event because the page is not
    // what received it — which is the whole point of claiming one.
    const message = parseHostMessage(
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
    );

    expect(message).toStrictEqual({
      shortcut: { alt: true, ctrl: false, key: 28, logo: false, shift: false },
      type: "shortcut",
    });
  });
});
