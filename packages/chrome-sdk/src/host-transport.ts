// A host connection, as the `BridgeClient` wants to see it.
//
// The compositor's socket carries newline-delimited JSON with an `app_frame`'s
// pixels following its header as raw bytes; `host-stream` turns that back into
// whole messages. This is the small amount of wiring between the two, kept
// apart from whoever opens the socket so that both halves can be tested
// without one.

import type { Transport } from "./bridge";
import { createHostStreamReader } from "./host-stream";
import { withFrameDelimiter } from "./newline-frames";

/** The part of a byte stream this needs, which is not much of one. */
export type HostConnection = {
  onData: (listener: (chunk: Uint8Array) => void) => void;
  write: (text: string) => void;
};

/** The clock the arrival stamp reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

/** One message, and when its bytes reached this process. */
type Arrived = {
  text: string;
  pixels?: Uint8Array<ArrayBuffer>;
  at: number;
};

/**
 * Read `connection` as the host protocol.
 *
 * Each message carries the moment its bytes arrived in this process, which is
 * what prices whatever sits between the socket and the page. Stamped per chunk
 * rather than per message: the chunk is what arrived, and the messages in it
 * all arrived with it.
 *
 * **Messages that arrive before the page registers are held, not dropped.**
 * The socket is open from preload time and the page's bundle runs later —
 * measured at 62ms after a reload and 166–205ms cold — so the gap is real, and
 * the compositor is already broadcasting into it. Dropping them silently would
 * lose whatever it sent with no signal that anything went missing.
 *
 * That is a trade rather than a free win: dropping was bounded and holding is
 * not. A page whose bundle never runs at all leaves this growing for as long
 * as the host keeps sending, at a full frame per broadcast. There is no cap
 * because there is no way to reach it today — the shell dies on stderr rather
 * than come up without its page — but a host that could would want one.
 */
export const hostTransport = (
  connection: HostConnection,
  now: typeof monotonicNow = monotonicNow,
): Transport => {
  const read = createHostStreamReader();
  const held: Arrived[] = [];
  let deliver:
    | ((
        text: string,
        pixels?: Uint8Array<ArrayBuffer>,
        sentAt?: number,
      ) => void)
    | undefined;

  const hand = (message: Arrived): void => {
    if (deliver === undefined) {
      held.push(message);
    } else {
      deliver(message.text, message.pixels, message.at);
    }
  };

  connection.onData((chunk) => {
    const at = now();
    for (const item of read(chunk)) {
      hand({ ...item, at });
    }
  });

  return {
    onMessage: (callback) => {
      deliver = callback;
      // Their own stamps, not this moment: the wait for the page to start is
      // not something the host's bytes spent crossing anything, and charging
      // them for it would report the page's own boot as transport cost.
      for (const message of held.splice(0)) {
        callback(message.text, message.pixels, message.at);
      }
    },
    send: (text) => {
      connection.write(withFrameDelimiter(text));
    },
  };
};
