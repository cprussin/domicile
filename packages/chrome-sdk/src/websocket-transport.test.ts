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
    // What a browser's WebSocket starts as, so a test can see it change.
    binaryType: "blob",
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
    binaryType: () => fake.binaryType,
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

  // A browser's WebSocket delivers a binary frame as a Blob unless it is told
  // otherwise, and `bytes` cannot read one — so an unset binaryType is a page
  // that hears nothing from the host while its own handshake still goes out.
  // That is the whole of what the shell on the fork did: it joined the
  // compositor, was announced a client, and never opened a window for it.
  it("asks for buffers, because a Blob is unreadable here", () => {
    // Starts at what a browser's own socket starts at, so this cannot pass by
    // the property never having existed.
    const wire = socket();

    webSocketTransport(wire.fake);

    expect(wire.binaryType()).toBe("arraybuffer");
  });

  // Three shapes reach `data` and all three are the same stream: an
  // ArrayBuffer, which is what the binaryType above buys; a view over one; and
  // — from a bridge that forwarded text rather than binary — a string.
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

  // Loudly, and this is the fix rather than a detail of it. Returning no bytes
  // is what dropped every frame the host sent while the page's own handshake
  // still went out — a desktop with no windows in it and nothing written down
  // anywhere. A Blob is the shape that gets here when binaryType did not take,
  // and it names itself so the console says which.
  it("throws on a frame it cannot read, naming what arrived", () => {
    const wire = socket();
    webSocketTransport(wire.fake);

    expect(() => {
      wire.arriveRaw(new Blob([new Uint8Array([1, 2, 3])]));
    }).toThrow(/cannot read.*Blob/);
    expect(() => {
      wire.arriveRaw({ not: "a frame" });
    }).toThrow(/cannot read.*Object/);
  });
});
