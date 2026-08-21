import { describe, expect, it } from "bun:test";

import { hostTransport } from "./host-transport";

/** A byte stream a test can push chunks into and read writes back off. */
const connection = () => {
  const written: string[] = [];
  let feed: ((chunk: Uint8Array) => void) | undefined;
  return {
    connection: {
      onData: (listener: (chunk: Uint8Array) => void) => {
        feed = listener;
      },
      write: (text: string) => {
        written.push(text);
      },
    },
    push: (text: string, pixels?: Uint8Array) => {
      const header = new TextEncoder().encode(text);
      const chunk = new Uint8Array(header.length + (pixels?.length ?? 0));
      chunk.set(header);
      if (pixels !== undefined) {
        chunk.set(pixels, header.length);
      }
      feed?.(chunk);
    },
    written,
  };
};

/** A clock that moves on every reading, so one stamp is not every stamp. */
const ticking = () => {
  let reading = 0;
  return () => {
    reading += 5;
    return reading;
  };
};

const FRAME = `{"type":"app_frame","app_id":"term","width":1,"height":1,"scale":1,"bytes":4}`;
const COMPOSITED = `{"type":"app_composited","app_id":"term"}`;

describe("hostTransport", () => {
  it("delivers each message with the moment its chunk arrived", () => {
    // The stamp is what prices everything between the socket and the page, and
    // it is taken by whoever read the socket precisely so that none of the
    // page's own work is inside it. Two messages in one chunk arrived at one
    // moment and say so — stamping per message would charge the second one for
    // handling the first, which the ticking clock is here to catch.
    const stream = connection();
    const received: [string, Uint8Array | undefined, number | undefined][] = [];
    const transport = hostTransport(stream.connection, ticking());
    transport.onMessage((text, pixels, sentAt) => {
      received.push([text, pixels, sentAt]);
    });

    stream.push(`${COMPOSITED}\n${FRAME}\n`, new Uint8Array([1, 2, 3, 4]));

    expect(received).toStrictEqual([
      [COMPOSITED, undefined, 5],
      [FRAME, new Uint8Array([1, 2, 3, 4]), 5],
    ]);
  });

  it("holds everything that arrives before the page is listening", () => {
    // The socket is open from preload time and the page's bundle runs later —
    // 62ms after a reload, 166ms cold — while the compositor is already
    // broadcasting into that gap. Dropping those messages loses them with no
    // signal that anything went missing.
    //
    // More than one held message, because with a single one "releases all of
    // them" and "releases them in order" are both unobservable — and releasing
    // all but the first is exactly the bug the hold exists to prevent.
    //
    // Each keeps the stamp of its own chunk. Restamping on release would put
    // the page's boot inside a number that reports transport cost.
    const stream = connection();
    const clock = ticking();
    const transport = hostTransport(stream.connection, clock);

    stream.push(`${COMPOSITED}\n`);
    stream.push(`${FRAME}\n`, new Uint8Array([1, 2, 3, 4]));
    clock();
    const received: [string, Uint8Array | undefined, number | undefined][] = [];
    transport.onMessage((text, pixels, sentAt) => {
      received.push([text, pixels, sentAt]);
    });
    stream.push(`${COMPOSITED}\n`);

    expect(received).toStrictEqual([
      [COMPOSITED, undefined, 5],
      [FRAME, new Uint8Array([1, 2, 3, 4]), 10],
      [COMPOSITED, undefined, 20],
    ]);
  });

  it("delimits what the page sends", () => {
    // The host reads this direction by lines. A message written without one
    // runs into the next, and neither is ever parsed.
    const stream = connection();

    hostTransport(stream.connection).send(`{"type":"hello"}`);

    expect(stream.written).toStrictEqual([`{"type":"hello"}\n`]);
  });
});
