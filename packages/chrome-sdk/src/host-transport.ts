// Two ends of one wire: the compositor's socket, and the page.
//
// They are in the same process but not in the same JavaScript world. The
// socket is held by the preload, which runs in the renderer's isolated world;
// the page runs in the main world. Getting a frame across that boundary is the
// single most expensive thing left in the copy path, because the obvious way
// to do it copies.
//
// Calling a function exposed with `contextBridge` **structured-clones every
// argument**, which for a window's pixels is megabytes per frame: measured at
// 9.9ms average and 11.7ms worst for a 1612x982 window. `window.postMessage`
// with the buffer in the transfer list moves it instead — the same frames
// measured at **0.11ms**, and the buffer detaches on the sending side, which
// is what proves nothing was copied.
//
// So the pixels are posted and only the small things go over the bridge.
// `postHostMessages` is the preload's half and `postedTransport` is the
// page's; they are kept in one file because the shape they agree on is the
// only thing either of them is about.

import { z } from "zod";

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

/** What marks a post as this transport's — anything at all can `postMessage`. */
const HOST_MESSAGE = "domicile:host-message";

/** One host message, on its way across the world boundary. */
export type PostedHostMessage = {
  readonly kind: typeof HOST_MESSAGE;
  readonly text: string;
  readonly pixels?: Uint8Array<ArrayBuffer>;
  /**
   * When the host's bytes reached this process, on the same clock the page
   * reads. What sits between the socket and the page is priced against it.
   */
  readonly at: number;
};

/**
 * The half of the transport the page reaches over the context bridge.
 *
 * Only text crosses here, so the clone this costs is the cost of a short JSON
 * line — which is nothing, and worth it for a call the page can make directly
 * rather than a second postMessage channel in the other direction.
 */
export type HostChannel = {
  /**
   * Say the page is listening. Anything held is posted at once, and everything
   * after it goes straight out.
   */
  listen: () => void;
  send: (text: string) => void;
};

/** How the preload puts a message into the page's world. */
export type Post = (
  message: PostedHostMessage,
  transfer: readonly Transferable[],
) => void;

/**
 * Read `connection` as the host protocol and post what it carries to the page.
 *
 * **Messages that arrive before the page is listening are held, not dropped.**
 * The socket is open from preload time and the page's bundle runs later —
 * measured at 62ms after a reload and 166-205ms cold — so the gap is real, and
 * the compositor is already broadcasting into it. `postMessage` has no
 * mailbox: a post made before the page added its listener is gone, with no
 * signal that anything went missing.
 *
 * That is a trade rather than a free win: dropping was bounded and holding is
 * not. A page whose bundle never runs at all leaves this growing for as long
 * as the host keeps sending, at a full frame per broadcast. There is no cap
 * because there is no way to reach it today — the shell dies on stderr rather
 * than come up without its page — but a host that could would want one.
 */
export const postHostMessages = (
  connection: HostConnection,
  post: Post,
  now: typeof monotonicNow = monotonicNow,
): HostChannel => {
  const read = createHostStreamReader();
  const held: PostedHostMessage[] = [];
  let listening = false;

  const hand = (message: PostedHostMessage): void => {
    if (listening) {
      // The pixels are *moved*. After this the buffer is detached here, which
      // is exactly what makes it free — and why `host-stream` gives each frame
      // a buffer of its own with nothing else in it.
      post(
        message,
        message.pixels === undefined ? [] : [message.pixels.buffer],
      );
    } else {
      held.push(message);
    }
  };

  connection.onData((chunk) => {
    // Stamped per chunk rather than per message: the chunk is what arrived,
    // and the messages in it all arrived with it.
    const at = now();
    for (const item of read(chunk)) {
      hand({ kind: HOST_MESSAGE, ...item, at });
    }
  });

  return {
    listen: () => {
      listening = true;
      // Their own stamps, not this moment: the wait for the page to start is
      // not something the host's bytes spent crossing anything, and charging
      // them for it would report the page's own boot as transport cost.
      for (const message of held.splice(0)) {
        hand(message);
      }
    },
    send: (text) => {
      connection.write(withFrameDelimiter(text));
    },
  };
};

/** Where the page hears posts — `window`, outside a test. */
export type PostTarget = {
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown; source: unknown }) => void,
  ) => void;
};

/**
 * The page's half: a [`Transport`] fed by what the preload posts.
 *
 * `listen` is not called until the page has somewhere to put a message, so
 * there is one hold rather than two — the preload keeps everything until this
 * end is ready, and after that nothing can arrive early.
 */
export const postedTransport = (
  target: PostTarget,
  channel: HostChannel,
): Transport => {
  let deliver:
    | ((
        text: string,
        pixels?: Uint8Array<ArrayBuffer>,
        sentAt?: number,
      ) => void)
    | undefined;

  target.addEventListener("message", (event) => {
    // A page hears every `postMessage` aimed at it, including any an embedded
    // document makes. Only this window's own posts are the preload's: a frame
    // is what the desktop draws windows out of, and taking one from a document
    // the shell is displaying would let it draw over the desktop. Silence
    // rather than a throw, because other traffic here is ordinary and none of
    // it is addressed to us.
    //
    // What this is and is not: it authenticates the *window*, not the world.
    // A plain `<iframe>` posting to its parent is rejected — `event.source` is
    // the child whichever function it borrows — but any script running in this
    // page's own main world satisfies it, and so does `parent.eval` from a
    // same-origin frame. That is a real widening from the bridged callback
    // this replaced, where page script had no way to deliver a message at all.
    // It is theoretical today: our bundle is the only main-world script, and
    // the one foreign document the shell displays is a `<domicile-webview>`
    // guest, which is its own top-level context and cannot reach this window
    // at all. A `MessagePort` would make it unforgeable rather than merely
    // hard to forge, and is the right shape if that stops being true.
    if (event.source !== target) {
      return;
    }
    const posted = postedHostMessage.safeParse(event.data);
    if (!posted.success) {
      return;
    }
    deliver?.(posted.data.text, posted.data.pixels, posted.data.at);
  });

  return {
    onMessage: (callback) => {
      deliver = callback;
      channel.listen();
    },
    send: (text) => {
      channel.send(text);
    },
  };
};

/**
 * What a post has to be to be treated as the host's.
 *
 * Parsed rather than asserted, even though the sender is our own preload: the
 * `event.source` check above is what says *which window* posted, and a claim
 * that the shape can therefore be trusted is the same claim that would delete
 * that check. A post carrying only `kind` would otherwise reach `deliver`
 * with three `undefined`s and throw inside a `message` listener, where nothing
 * is watching.
 */
const postedHostMessage = z.object({
  at: z.number(),
  kind: z.literal(HOST_MESSAGE),
  pixels: z.instanceof(Uint8Array).optional(),
  text: z.string(),
});
