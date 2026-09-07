// The page's wire to the host when there is no preload to hold it.
//
// Under Electron the socket is the preload's: it runs in the renderer's
// isolated world, owns the unix socket, and `postMessage`s across the world
// boundary. See `host-transport.ts`, which is that.
//
// The fork has no preload and no world boundary — docs/architecture
// /ENGINE-FORK.md is explicit that we ship the fork and Electron goes — and a
// page cannot open a unix socket. So something outside has to hold that end
// and offer the page one it can open. This is the page's half of that.
//
// A DUMB PIPE, DELIBERATELY. WebSocket gives message boundaries and it would
// be tempting to make each frame one JSON line, but then the bridge has to
// understand the protocol to split the stream — and a bridge that parses is a
// bridge that can corrupt. It forwards the socket's bytes as binary frames
// instead, arriving here as whatever chunks the kernel handed it, and the
// framing is `createHostStreamReader`'s exactly as it is on the other path.
// The bridge cannot get the protocol wrong because it never looks at it.

import type { Transport } from "./bridge";
import { createHostStreamReader } from "./host-stream";
import { withFrameDelimiter } from "./newline-frames";

/** The clock the arrival stamp reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

/**
 * As much of `WebSocket` as this needs, which is not much of one — and named
 * so a test can supply it without a browser.
 */
export type WebSocketLike = {
  readonly readyState: number;
  /**
   * `data` is optional so that a real `WebSocket` satisfies this. Its
   * `addEventListener` is typed against `Event`, which carries no `data` at
   * all — and a listener that required one would make the browser's own
   * socket unassignable here, which would leave a cast at every call site
   * standing in for a type that could simply be right.
   */
  addEventListener: (
    type: "message" | "open" | "close",
    listener: (event: { data?: unknown }) => void,
  ) => void;
  send: (data: string) => void;
};

/** `WebSocket.OPEN`, spelled out so this file needs no DOM lib at runtime. */
const OPEN = 1;

/**
 * A [`Transport`] over `socket`.
 *
 * **Both directions are held rather than dropped**, and for the same reason
 * the preload path holds: the two ends do not become ready at the same moment
 * and neither has a mailbox.
 *
 * Incoming, because the socket is open before the page's bundle has run — the
 * host starts talking the moment it connects, with a `welcome` and one
 * `app_appeared` per client already running, and a page that registered its
 * handler tens of milliseconds later would have missed a live client's window.
 * That is the same gap `postHostMessages` measured at 62ms on a reload.
 *
 * Outgoing, because a shell that calls `hello` before the socket finishes
 * opening would otherwise throw `InvalidStateError` — and the handshake is the
 * first thing any shell does.
 *
 * Neither queue is capped, which is a trade rather than an oversight: the same
 * one `postHostMessages` documents. A page whose bundle never runs leaves the
 * incoming side growing for as long as the host keeps talking. There is no way
 * to reach that today, because a shell that cannot show its page dies on
 * stderr instead.
 */
export const webSocketTransport = (
  socket: WebSocketLike,
  now: typeof monotonicNow = monotonicNow,
): Transport => {
  const read = createHostStreamReader();
  const held: { text: string; at: number }[] = [];
  const unsent: string[] = [];
  let deliver: ((text: string, sentAt?: number) => void) | undefined;

  const hand = (message: { text: string; at: number }): void => {
    if (deliver) {
      deliver(message.text, message.at);
    } else {
      held.push(message);
    }
  };

  socket.addEventListener("message", (event) => {
    const { data } = event;
    // Stamped per chunk rather than per message: the chunk is what arrived,
    // and every message in it arrived with it. The same reasoning, and the
    // same stamp, as the preload path — so a number from either is comparable
    // with a number from the other.
    const at = now();
    for (const item of read(bytes(data))) {
      hand({ at, text: item.text });
    }
  });

  socket.addEventListener("open", () => {
    for (const text of unsent.splice(0)) {
      socket.send(text);
    }
  });

  return {
    onMessage: (callback) => {
      deliver = callback;
      // Their own stamps, not this moment: the wait for the page to start is
      // not time the host's bytes spent crossing anything, and charging them
      // for it would report the page's own boot as transport cost.
      for (const message of held.splice(0)) {
        deliver(message.text, message.at);
      }
    },
    send: (text) => {
      const framed = withFrameDelimiter(text);
      if (socket.readyState === OPEN) {
        socket.send(framed);
      } else {
        unsent.push(framed);
      }
    },
  };
};

/**
 * What a message event's `data` is, as bytes.
 *
 * The bridge sends binary frames, which a browser hands over as an
 * `ArrayBuffer` when `binaryType` is set and as a `Blob` when it is not —
 * and a Blob is only readable asynchronously, which would reorder the stream.
 * So a string is accepted too and encoded: it is what a bridge that forwarded
 * text would produce, and the line reader cannot tell the difference.
 * Anything else is not a frame this understands, and an empty chunk is what
 * the reader does nothing with.
 */
const bytes = (data: unknown): Uint8Array => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return new Uint8Array();
};
