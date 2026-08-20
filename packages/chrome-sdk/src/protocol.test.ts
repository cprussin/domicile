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
