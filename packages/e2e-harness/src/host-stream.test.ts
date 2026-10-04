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

describe("createHostStreamReader", () => {
  it("reads a plain message as text", () => {
    const read = createHostStreamReader();
    expect(read(bytes('{"type":"welcome","protocol_version":3}\n'))).toEqual([
      { text: '{"type":"welcome","protocol_version":3}' },
    ]);
  });

  it("reads several messages out of one chunk", () => {
    const read = createHostStreamReader();
    expect(
      read(bytes('{"type":"focus"}\n{"type":"app_closed","app_id":"a"}\n')),
    ).toEqual([
      { text: '{"type":"focus"}' },
      { text: '{"type":"app_closed","app_id":"a"}' },
    ]);
  });

  it("holds a message that straddles a chunk boundary until it is whole", () => {
    // A socket cuts wherever it likes. Emitting the first half as a message
    // would hand the page a fragment of JSON to parse.
    const read = createHostStreamReader();
    const line = '{"type":"app_closed","app_id":"terminal"}\n';
    expect(read(bytes(line.slice(0, 20)))).toEqual([]);
    expect(read(bytes(line.slice(20)))).toEqual([{ text: line.trimEnd() }]);
  });

  it("drops blank lines from keepalive newlines", () => {
    const read = createHostStreamReader();
    expect(read(bytes('\n  \n{"type":"focus"}\n'))).toEqual([
      { text: '{"type":"focus"}' },
    ]);
  });

  it("reads a long run of messages in linear time", () => {
    // Messages arrive in many chunks and the reader keeps them as they came,
    // joining only to complete a line. Joining the whole backlog per chunk is
    // quadratic — the shape that cost seconds when frames came down here too,
    // and the reason the pending chunks are still kept as a list.
    const read = createHostStreamReader();
    const line = `{"type":"app_titled","app_id":"a","title":"${"x".repeat(1000)}"}\n`;
    const started = performance.now();
    let seen = 0;
    for (let index = 0; index < 2000; index++) {
      seen += read(bytes(line)).length;
    }
    expect(seen).toBe(2000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
