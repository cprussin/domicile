import { describe, expect, it } from "bun:test";

import { createHostStreamReader } from "./host-stream";

const encoder = new TextEncoder();

const bytes = (...parts: (string | Uint8Array)[]): Uint8Array => {
  const chunks = parts.map((part) =>
    typeof part === "string" ? encoder.encode(part) : part,
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
};

const frameHeader = (byteCount: number): string =>
  `{"type":"app_frame","app_id":"a","width":2,"height":1,"format":"rgba","bytes":${byteCount}}\n`;

describe("createHostStreamReader", () => {
  it("reads a plain message as text with no pixels", () => {
    const read = createHostStreamReader();
    expect(read(bytes('{"type":"welcome","protocol_version":3}\n'))).toEqual([
      { text: '{"type":"welcome","protocol_version":3}' },
    ]);
  });

  it("reads the pixels that follow a frame header", () => {
    const read = createHostStreamReader();
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const [frame, ...rest] = read(bytes(frameHeader(8), pixels));
    expect(rest).toEqual([]);
    expect(frame?.pixels).toEqual(pixels);
    expect(JSON.parse(frame?.text ?? "").width).toBe(2);
  });

  it("holds a frame until every pixel has arrived", () => {
    const read = createHostStreamReader();
    expect(read(bytes(frameHeader(4)))).toEqual([]);
    expect(read(bytes(new Uint8Array([1, 2])))).toEqual([]);
    const [frame] = read(bytes(new Uint8Array([3, 4])));
    expect(frame?.pixels).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("keeps reading messages after a frame's pixels", () => {
    const read = createHostStreamReader();
    const items = read(
      bytes(
        frameHeader(2),
        new Uint8Array([9, 9]),
        '{"type":"app_closed","app_id":"a"}\n',
      ),
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.pixels).toEqual(new Uint8Array([9, 9]));
    expect(items[1]).toEqual({ text: '{"type":"app_closed","app_id":"a"}' });
  });

  it("splits a header that straddles a chunk boundary", () => {
    const read = createHostStreamReader();
    const header = frameHeader(2);
    expect(read(bytes(header.slice(0, 20)))).toEqual([]);
    const [frame] = read(bytes(header.slice(20), new Uint8Array([7, 7])));
    expect(frame?.pixels).toEqual(new Uint8Array([7, 7]));
  });

  it("never splits a pixel run on a byte that looks like a newline", () => {
    // Pixel data contains 0x0a constantly — it is just a colour value. A reader
    // that keeps scanning for newlines inside the payload would cut the frame
    // in half and desynchronise the stream from there on.
    const read = createHostStreamReader();
    const pixels = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]);
    const [frame, ...rest] = read(bytes(frameHeader(4), pixels));
    expect(frame?.pixels).toEqual(pixels);
    expect(rest).toEqual([]);
  });

  it("drops blank lines from keepalive newlines", () => {
    const read = createHostStreamReader();
    expect(read(bytes('\n  \n{"type":"focus"}\n'))).toEqual([
      { text: '{"type":"focus"}' },
    ]);
  });

  it("hands back a frame that owns its buffer and nothing more", () => {
    // The page is handed these bytes by *transfer* rather than by copy, and a
    // transfer moves the whole `ArrayBuffer`. A view onto a larger buffer —
    // the shape a join-then-slice reader produces — would take the messages
    // that arrived behind the frame with it, and detach them mid-read.
    const read = createHostStreamReader();

    const [frame] = read(
      bytes(
        frameHeader(4),
        new Uint8Array([1, 2, 3, 4]),
        '{"type":"app_closed","app_id":"a"}\n',
      ),
    );

    expect(frame?.pixels).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(frame?.pixels?.byteOffset).toBe(0);
    expect(frame?.pixels?.buffer.byteLength).toBe(4);
  });

  it("reassembles a frame-sized payload in linear time", () => {
    // Pixels arrive in many small chunks; re-joining the buffer on each one is
    // quadratic, which at frame size costs seconds.
    const read = createHostStreamReader();
    const chunk = new Uint8Array(64 * 1024);
    const total = 400 * chunk.length;
    const started = performance.now();
    expect(read(bytes(frameHeader(total)))).toEqual([]);
    for (let index = 0; index < 399; index++) {
      expect(read(chunk)).toEqual([]);
    }
    const [frame] = read(chunk);
    expect(frame?.pixels).toHaveLength(total);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
