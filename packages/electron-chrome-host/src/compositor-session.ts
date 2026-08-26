// What the compositor publishes once it is up, read back by the shell that
// started it.
//
// The shell picks where this is written and waits for it to appear. Everything
// in it is something the shell cannot know in advance: the Wayland displays are
// named by the compositor, and whether it is compositing is decided by whether
// it got a window.

import { z } from "zod";

/**
 * The wire shape, which is `domicile-launch`'s `Session` struct.
 *
 * Snake case here and camel case in memory: the boundary is where the two
 * conventions meet, and mapping in one place beats every reader remembering
 * which side of it they are on.
 */
const wireSession = z
  .object({
    chrome_socket: z.string().min(1),
    chrome_wayland_display: z.string().min(1),
    composited: z.boolean(),
    protocol: z.number().int().positive(),
    wayland_display: z.string().min(1),
  })
  .transform((document) => ({
    chromeSocket: document.chrome_socket,
    chromeWaylandDisplay: document.chrome_wayland_display,
    composited: document.composited,
    protocol: document.protocol,
    waylandDisplay: document.wayland_display,
  }));

/** A running compositor, as the shell that started it sees it. */
export type CompositorSession = z.infer<typeof wireSession>;

/**
 * Read a published session, or throw saying why it could not be read.
 *
 * Throws rather than returning a result: there is nothing a shell can do with
 * a compositor it cannot address, and the only useful thing left is to say so
 * and stop.
 */
export const parseSession = (text: string): CompositorSession =>
  wireSession.parse(JSON.parse(text));

/**
 * Write a session back out in the shape [`parseSession`] reads.
 *
 * The launcher passes the session on to the chrome's own process, and doing
 * that in the compositor's own wire shape means there is one schema rather
 * than two that have to agree.
 */
export const sessionDocument = (session: CompositorSession): string =>
  JSON.stringify({
    chrome_socket: session.chromeSocket,
    chrome_wayland_display: session.chromeWaylandDisplay,
    composited: session.composited,
    protocol: session.protocol,
    wayland_display: session.waylandDisplay,
  });
