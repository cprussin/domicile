import { describe, expect, it } from "bun:test";

import type { PostedHostMessage, PostTarget } from "./host-transport";
import { postedTransport, postHostMessages } from "./host-transport";

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

/**
 * The boundary between the two worlds: what was posted, what came with it in
 * the transfer list, and the window the page listens on.
 *
 * Delivery is synchronous here where the real one is a task, because what
 * these pin is *what* crosses rather than when.
 */
const boundary = () => {
  const posted: { message: PostedHostMessage; transfer: Transferable[] }[] = [];
  const listeners: ((event: { data: unknown; source: unknown }) => void)[] = [];
  const target: PostTarget = {
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
  };
  return {
    /** A post from somewhere that is not the preload — an embedded document. */
    forge: (data: unknown, source: unknown) => {
      for (const listener of listeners) {
        listener({ data, source });
      }
    },
    post: (message: PostedHostMessage, transfer: readonly Transferable[]) => {
      posted.push({ message, transfer: [...transfer] });
      for (const listener of listeners) {
        listener({ data: message, source: target });
      }
    },
    posted,
    target,
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

const TITLED = `{"type":"app_titled","app_id":"term","title":"a window"}`;
const COMPOSITED = `{"type":"app_composited","app_id":"term"}`;

/** Both halves, wired to each other the way the shell wires them. */
const wired = (clock = ticking()) => {
  const stream = connection();
  const world = boundary();
  const channel = postHostMessages(stream.connection, world.post, clock);
  const transport = postedTransport(world.target, channel);
  const received: [string, number | undefined][] = [];
  return {
    listen: () => {
      transport.onMessage((text, sentAt) => {
        received.push([text, sentAt]);
      });
    },
    received,
    stream,
    transport,
    world,
  };
};

describe("the host transport", () => {
  it("posts every message with an empty transfer list", () => {
    // This file exists because of the transfer list: pixels used to cross here
    // and a `contextBridge` call structured-clones its arguments, which for a
    // 1612x982 window measured 9.9ms average against 0.11ms for a post that
    // moved the buffer instead.
    //
    // No pixels cross now — a client's buffer goes to the display compositor —
    // so every message is small JSON and nothing is transferred. Asserted
    // rather than assumed: a message that transferred something would mean a
    // buffer had found its way back onto this wire, and detaching it here is
    // the kind of failure that shows up as a message going missing much later.
    const wire = wired();
    wire.listen();

    wire.stream.push(`${TITLED}\n`);
    expect(wire.world.posted[0]?.transfer).toStrictEqual([]);

    wire.stream.push(`${COMPOSITED}\n`);
    expect(wire.world.posted[1]?.transfer).toStrictEqual([]);
  });

  it("delivers each message with the moment its chunk arrived", () => {
    // The stamp is what prices everything between the socket and the page, and
    // it is taken by whoever read the socket precisely so that none of the
    // page's own work is inside it. Two messages in one chunk arrived at one
    // moment and say so — stamping per message would charge the second one for
    // handling the first, which the ticking clock is here to catch.
    const wire = wired();
    wire.listen();

    wire.stream.push(`${COMPOSITED}\n${TITLED}\n`);

    expect(wire.received).toStrictEqual([
      [COMPOSITED, 5],
      [TITLED, 5],
    ]);
  });

  it("holds everything that arrives before the page is listening", () => {
    // The socket is open from preload time and the page's bundle runs later —
    // 62ms after a reload, 166ms cold — while the compositor is already
    // broadcasting into that gap. `postMessage` has no mailbox, so a post made
    // then is simply gone.
    //
    // More than one held message, because with a single one "releases all of
    // them" and "releases them in order" are both unobservable — and releasing
    // all but the first is exactly the bug the hold exists to prevent.
    //
    // Each keeps the stamp of its own chunk. Restamping on release would put
    // the page's boot inside a number that reports transport cost.
    const clock = ticking();
    const wire = wired(clock);

    wire.stream.push(`${COMPOSITED}\n`);
    wire.stream.push(`${TITLED}\n`);
    expect(wire.world.posted).toStrictEqual([]);
    clock();
    wire.listen();
    wire.stream.push(`${COMPOSITED}\n`);

    expect(wire.received).toStrictEqual([
      [COMPOSITED, 5],
      [TITLED, 10],
      [COMPOSITED, 20],
    ]);

    // And the hold is *emptied*, not merely read. A second `listen` that
    // handed everything again would deliver every held message twice, and
    // nothing structural prevents the second call: `Transport.onMessage`
    // carries no call-once contract, and emptying the hold is the only reason
    // one would be harmless.
    const handed = wire.world.posted.length;
    wire.listen();

    expect(wire.world.posted).toHaveLength(handed);
  });

  it("takes host messages only from its own window", () => {
    // A page hears every `postMessage` aimed at it. A frame is what the
    // desktop draws its windows out of, so one taken from a document the shell
    // is merely displaying would let that document draw over the desktop.
    const wire = wired();
    wire.listen();

    wire.world.forge(
      { at: 1, kind: "domicile:host-message", text: COMPOSITED },
      { somethingElse: true },
    );
    // And something from the right window that is not ours at all — an
    // ordinary `postMessage` between two parts of the page.
    wire.world.forge({ hello: "there" }, wire.world.target);

    expect(wire.received).toStrictEqual([]);
  });

  it("delimits what the page sends", () => {
    // The host reads this direction by lines. A message written without one
    // runs into the next, and neither is ever parsed.
    const wire = wired();

    wire.transport.send(`{"type":"hello"}`);

    expect(wire.stream.written).toStrictEqual([`{"type":"hello"}\n`]);
  });
});
