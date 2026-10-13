import { describe, expect, it } from "bun:test";

import { encodeFrame, frameDecoder } from "./frames";

const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

describe(encodeFrame, () => {
  it("prefixes the UTF-8 JSON with its byte length, little-endian", () => {
    expect([...encodeFrame({ name: "é" })]).toEqual([
      13,
      0,
      0,
      0,
      ...new TextEncoder().encode('{"name":"é"}'),
    ]);
  });
});

describe(frameDecoder, () => {
  it("yields every whole message in a chunk", () => {
    const decode = frameDecoder();
    expect(
      decode(concat(encodeFrame({ id: 1 }), encodeFrame(["two", 2]))),
    ).toEqual([{ id: 1 }, ["two", 2]]);
  });

  it("joins a message split anywhere, even inside its length or a character", () => {
    const decode = frameDecoder();
    const bytes = concat(encodeFrame({ text: "héllo" }), encodeFrame(3));
    const decoded = [...bytes].flatMap((byte) => decode(Uint8Array.of(byte)));
    expect(decoded).toEqual([{ text: "héllo" }, 3]);
  });

  it("keeps the start of the next message after a whole one", () => {
    const decode = frameDecoder();
    const next = encodeFrame({ id: 2 });
    expect(decode(concat(encodeFrame({ id: 1 }), next.slice(0, 6)))).toEqual([
      { id: 1 },
    ]);
    expect(decode(next.slice(6))).toEqual([{ id: 2 }]);
  });
});
