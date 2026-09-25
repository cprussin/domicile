// How the pages of one desk stay one desktop.
//
// **A DESK OF SEVERAL MONITORS IS SEVERAL PAGES**, because one browser window
// cannot span two CRTCs — the engine opens one per display and each loads this
// same shell. The workspaces span the desk, though: `workspace 2` goes to
// whichever monitor is showing it, a window opens on the screen the keyboard
// is on, and a hidden workspace stays with the monitor it was last on. None of
// that is answerable a screen at a time.
//
// So one page reduces the desktop and the others show it. Which one is not
// negotiated — `leadsTheDesk` in `useWindows` reads it off the desk every page
// is already told — and what crosses is this: a page asking for the desktop, a
// page asking for something to be done to it, and the page that reduces it
// saying what it now is.

import { z } from "zod";

import type { WindowAction, WindowState } from "./window-state";

/**
 * Something that came off the channel and is an object.
 *
 * **WHAT IS CHECKED HERE AND WHAT IS TRUSTED.** The three shapes below are a
 * contract across a runtime boundary, so the envelope is parsed at the edge
 * like any other. The desktop inside one is not: both ends of this channel are
 * the same module of the same built shell — one engine serves one shell to
 * every window of one desk — so a schema for `WindowState` would be a second
 * definition of the desktop for every future change to keep in step, and the
 * thing it would catch cannot happen. What is left to check is that a message
 * is one of the three, which is what this and the union below do.
 */
const anObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null;

const deskMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asked") }),
  z.object({
    action: z.custom<WindowAction>(anObject),
    type: z.literal("acted"),
  }),
  z.object({ desk: z.custom<WindowState>(anObject), type: z.literal("desk") }),
]);

/** What one page of a desk says to the others. */
export type DeskMessage = z.infer<typeof deskMessageSchema>;

/** One of the three, by the name it goes under. */
type Said<T extends DeskMessage["type"]> = Extract<DeskMessage, { type: T }>;

export const DeskMessage = {
  /**
   * A command for whichever page reduces the desktop.
   *
   * The command itself rather than its outcome: every page runs the same
   * reduction, so what a press means is settled in one place and the page that
   * heard it does not have to work out what it did.
   */
  Acted: (action: WindowAction): Said<"acted"> => ({ action, type: "acted" }),

  /** A page asking what the desktop is, because it has just come up. */
  Asked: (): Said<"asked"> => ({ type: "asked" }),

  /**
   * What the desktop is now.
   *
   * **THE WHOLE OF IT, NOT WHAT CHANGED.** A page that came up late, a page
   * whose message was dropped and a page that has been listening all along all
   * take the same thing from this, so there is no catching up to get wrong.
   * The desktop is a few windows and ten workspaces; the cost of sending it
   * whole is a structured clone on a keystroke.
   */
  Desk: (desk: WindowState): Said<"desk"> => ({ desk, type: "desk" }),
};

/** A message off the channel, or `undefined` for anything else on it. */
export const heardFrom = (data: unknown): DeskMessage | undefined =>
  deskMessageSchema.safeParse(data).data;

/**
 * The other pages of this desk, to say things to and hear things from.
 *
 * A port rather than a `BroadcastChannel` outright, so the desktop's own
 * behavior is testable without one: what the pages of a desk agree on is
 * logic, and a test of it should not need a browser's message bus.
 */
export type DeskChannel = {
  /** Say this to every other page of the desk. Not to this one. */
  post: (message: DeskMessage) => void;
  /** Hear what the others say. Returns the teardown. */
  listen: (heard: (message: DeskMessage) => void) => () => void;
};

/**
 * What the channel is called. Per origin, which is per desk: the engine serves
 * one shell to one desk's windows and nothing else is on `domicile://`.
 */
const DESK = "domicile-desk";

/**
 * The real channel, over the browser's own message bus.
 *
 * `BroadcastChannel` delivers to every other page of the origin and never to
 * the sender, which is exactly the shape this wants: the page that posted a
 * command has already run it if it is the one that reduces, and has nothing to
 * do with it if it is not.
 *
 * **A page with no bus is a page with nobody to talk to**, which is a shell
 * opened in a plain browser for styling work — the same case `connectToHost`
 * answers one process further out, and answered the same way: say so once and
 * hand back a stand-in, so the desktop still opens.
 */
export const deskChannel = (): DeskChannel => {
  if (typeof BroadcastChannel === "undefined") {
    // biome-ignore lint/suspicious/noConsole: the one line saying why a second monitor would show a desktop of its own
    console.warn(
      "domicile: no BroadcastChannel here, so this page is the whole desk. A " +
        "desk of several monitors needs one: its pages agree over it.",
    );
    return {
      listen: () => () => undefined,
      post: () => undefined,
    };
  } else {
    const channel = new BroadcastChannel(DESK);
    return {
      listen: (heard) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          const message = heardFrom(event.data);
          if (message !== undefined) {
            heard(message);
          }
        };
        channel.addEventListener("message", onMessage);
        return () => {
          channel.removeEventListener("message", onMessage);
        };
      },
      post: (message) => {
        channel.postMessage(message);
      },
    };
  }
};
