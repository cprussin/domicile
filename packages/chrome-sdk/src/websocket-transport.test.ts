import { describe, expect, it } from "bun:test";

import type { WebSocketLike } from "./websocket-transport";
import { webSocketTransport } from "./websocket-transport";

/** A socket a test drives: what was sent, and what it can be told arrived. */
const socket = (readyState = 1) => {
  const listeners = new Map<string, ((event: never) => void)[]>();
  const sent: string[] = [];
  const fake = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    readyState,
    send: (data: string) => {
      sent.push(data);
    },
  };
  const fire = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event as never);
    }
  };
  return {
    arrive: (text: string) =>
      fire("message", { data: new TextEncoder().encode(text) }),
    arriveRaw: (data: unknown) => fire("message", { data }),
    fake: fake as unknown as WebSocketLike,
    open: () => {
      fake.readyState = 1;
      fire("open", {});
    },
    sent,
  };
};

describe("webSocketTransport", () => {
  it("delivers a whole line as one message", () => {
    const wire = socket();
    const transport = webSocketTransport(wire.fake);
    const seen: string[] = [];
    transport.onMessage((text) => seen.push(text));

    wire.arrive('{"type":"welcome"}\n');

    expect(seen).toEqual(['{"type":"welcome"}']);
  });

  // The bridge is a byte pipe, so a message can arrive in as many pieces as
  // the kernel felt like. Nothing may be delivered until the newline does.
  it("waits for the rest of a line split across frames", () => {
    const wire = socket();
    const transport = webSocketTransport(wire.fake);
    const seen: string[] = [];
    transport.onMessage((text) => seen.push(text));

    wire.arrive('{"type":"wel');
    expect(seen).toEqual([]);
    wire.arrive('come"}\n{"type":"app_appeared"}\n');

    expect(seen).toEqual(['{"type":"welcome"}', '{"type":"app_appeared"}']);
  });

  // The gap this exists for: the socket is open and the host is already
  // talking before the page's bundle has registered a handler. Dropping what
  // lands in between is a live client with no window and no sign of one.
  it("holds what arrives before the page is listening", () => {
    const wire = socket();
    const transport = webSocketTransport(wire.fake);

    wire.arrive('{"type":"welcome"}\n{"type":"app_appeared"}\n');
    const seen: string[] = [];
    transport.onMessage((text) => seen.push(text));

    expect(seen).toEqual(['{"type":"welcome"}', '{"type":"app_appeared"}']);
  });

  // Their own arrival stamps, not the moment the page got round to listening:
  // charging held messages for the page's boot would report it as transport
  // cost, and this number is an input to a latency measurement.
  it("holds each message's own arrival stamp", () => {
    const wire = socket();
    let clock = 10;
    const transport = webSocketTransport(wire.fake, () => clock);

    wire.arrive('{"a":1}\n');
    clock = 25;
    wire.arrive('{"b":2}\n');
    clock = 900;

    const stamps: (number | undefined)[] = [];
    transport.onMessage((_text, sentAt) => stamps.push(sentAt));

    expect(stamps).toEqual([10, 25]);
  });

  it("frames what it sends with a newline", () => {
    const wire = socket();
    const transport = webSocketTransport(wire.fake);

    transport.send('{"type":"hello"}');

    expect(wire.sent).toEqual(['{"type":"hello"}\n']);
  });

  // A shell's first act is the handshake, and it makes it as soon as its
  // bundle runs — which can be before the socket has finished opening.
  // Sending then throws InvalidStateError in a browser.
  it("holds what is sent before the socket opens, in order", () => {
    const wire = socket(0);
    const transport = webSocketTransport(wire.fake);

    transport.send('{"type":"hello"}');
    transport.send('{"type":"declare_screens"}');
    expect(wire.sent).toEqual([]);

    wire.open();

    expect(wire.sent).toEqual([
      '{"type":"hello"}\n',
      '{"type":"declare_screens"}\n',
    ]);
  });

  // Three shapes reach `data` depending on the bridge and the socket's
  // binaryType, and all three are the same stream: an ArrayBuffer, a view over
  // one, and — from a bridge that forwarded text rather than binary — a
  // string. A Blob is the fourth and is deliberately not supported: it is only
  // readable asynchronously, which would reorder the stream.
  it("reads a buffer, a view and a string as the same bytes", () => {
    for (const frame of [
      new TextEncoder().encode('{"type":"welcome"}\n').buffer,
      new TextEncoder().encode('{"type":"welcome"}\n'),
      '{"type":"welcome"}\n',
    ]) {
      const wire = socket();
      const transport = webSocketTransport(wire.fake);
      const seen: string[] = [];
      transport.onMessage((text) => seen.push(text));

      wire.arriveRaw(frame);

      expect(seen).toEqual(['{"type":"welcome"}']);
    }
  });

  // Anything else is not a frame this understands. Silence rather than a
  // throw: a stray frame must not take the desktop down, and the reader does
  // nothing with an empty chunk.
  it("ignores a frame that is not bytes or text", () => {
    const wire = socket();
    const transport = webSocketTransport(wire.fake);
    const seen: string[] = [];
    transport.onMessage((text) => seen.push(text));

    wire.arriveRaw({ not: "a frame" });
    wire.arrive('{"type":"welcome"}\n');

    expect(seen).toEqual(['{"type":"welcome"}']);
  });
});
