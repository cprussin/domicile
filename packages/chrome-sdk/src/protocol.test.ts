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
});
