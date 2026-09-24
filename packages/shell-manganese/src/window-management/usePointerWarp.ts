import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Focus, Spot } from "./pointer-warp";
import { warpTo } from "./pointer-warp";

/**
 * How many places asked for may be outstanding at once.
 *
 * One per place the engine has not answered, and an answer gives up every
 * older one with it — so this is only ever reached by warps answered by
 * nothing at all. One the engine declines outright is such a warp —
 * `WarpPointerIn` has no frame to warp within, or `PointerWarpTarget` is
 * given a page of no size — and so is one whose landing this page is never
 * told about, which a cursor put down inside a browser window's own page may
 * well be: the pointer in there is the guest's, and whether the element
 * holding it hears the crossing is not something this shell can see. A spot
 * the engine had to pull back inside the page is neither — the cursor still
 * moves, and the arrival somewhere unasked-for clears the list rather than
 * lengthening it.
 *
 * What overflowing costs is worth being plain about, because it is not
 * nothing. The place dropped is one this page will not know the cursor by if
 * it does arrive there, so that arrival reads as the hand — and takes the
 * places still outstanding down with it. Four presses answered by nothing is
 * the price of not keeping a list that only grows.
 */
const IN_FLIGHT = 4;

type Options = {
  domicile: DomicileClient;
  /** The window the keyboard is in and the box it is drawn in, or none. */
  focus: Focus | undefined;
  /**
   * Whether a key ran the command this render is the answer to, which is the
   * press this spends. Nothing but the keyboard path may set it: a focus the
   * pointer itself moved is one the warp must leave alone, or the desktop
   * chases its own cursor.
   *
   * A ref handed in rather than a callback handed back, because the desk is
   * one keyboard and several monitors. The keys are read once per page and
   * the windows are laid out once per screen, so the press happens above
   * every copy of this hook and is spent by whichever of them the focus
   * landed on. Cleared by the desk once every monitor has had its look —
   * `Desktop` — rather than here, which is what stops the first monitor to
   * run its effect from spending a press meant for the second.
   */
  keyed: RefObject<boolean>;
  /**
   * Every window the desktop has, by id.
   *
   * Read for one thing: whether the window the keyboard is on is one that was
   * not there last render, which is a window that has just opened.
   */
  windows: readonly string[];
};

/** What the desktop asks about the pointer. */
export type Pointer = {
  /**
   * Whether a pointer event at `at` is the pointer having gone there.
   *
   * **The place is the whole of the answer.** A window that arrives under a
   * hand nobody moved arrives at the spot the pointer is already at, and one
   * the pointer crossed into is somewhere it was not — which is as true of
   * the `pointerover` a crossing fires as of the `pointermove` behind it.
   * Asking the event rather than keeping a flag is what makes it so: a flag
   * would have to be cleared by a `pointermove`, and a crossing fires its
   * `pointerover` *first*, so the window the user had just reached for would
   * be the one swallowed.
   *
   * **There are two such spots while a warp is in the air**, which is what
   * makes this a state rather than a comparison. The engine is asked to move
   * the cursor and says nothing about having done it, so until something
   * arrives at the place it was sent, the cursor is either still where the
   * page last saw it or already there — and a window turning up at either is
   * a window that came to the pointer. Whatever turns up anywhere else is the
   * pointer having gone there, which settles the question and is why this
   * writes as well as reads.
   *
   * It fails open for a pointer this page has never seen: the engine draws a
   * cursor and says nothing about where, and a desktop that took its own
   * guess for that would swallow the first window the user crossed into.
   *
   * **One ambiguity is left, and this is the side it is left on.** A place
   * asked for twice with another in between — three presses inside a frame,
   * aimed there and back — arrives once if the engine coalesced the middle
   * one away and three times if it did not, and nothing in an arrival says
   * which happened. Taken as the coalesced one, the places still listed are
   * given up and the landings that follow read as the hand: a keyboard handed
   * to a window nobody reached for, and a `focus parent` selection undone
   * with it. Taken the other way, a place asked for before the arrival stays
   * listed with nothing left to answer it, and a crossing landing exactly on
   * it reads as the desktop's own.
   *
   * The second is the cheaper mistake, and not by a little. A place listed is
   * the middle of a window, and a middle is where the desktop puts a cursor
   * rather than where a pointer usually crosses into one: pointer motion is
   * sampled, so a crossing is dispatched wherever the move that carried it
   * landed — near the edge it came in by for any ordinary movement, and a
   * flick can carry it further in. It is a small target either way, it has to
   * be hit in the one dispatch between a coalesced landing and the hand's
   * next movement, and a stray `pointermove` over it spends it first;
   * anything anywhere else clears the lot.
   *
   * It is worth knowing what being wrong that way costs, all the same,
   * because it is not a flicker: a crossing refused leaves the pointer inside
   * an `<app>`, which has no children to fire another, so the keyboard stays
   * where it was until the pointer leaves that window and comes back. That is
   * the intended answer for a window sliding under a still hand. It is the
   * price of the ambiguity for the one that was really crossed into.
   */
  pointing: (at: Spot) => boolean;
};

/**
 * Take the pointer with the keyboard, so that the focus stays where the
 * desktop put it — `mouse_warping container` from the config.
 *
 * **What it is for is in `pointer-warp.ts`**, which is where the decision is
 * and where the reason it exists is written down. This is the half a page has
 * to do: which focus changes were the desktop's own, where the pointer is,
 * and what to ask the engine for once the window has been laid out at its new
 * box.
 *
 * **Three of them are the desktop's own, and they arrive differently.** A key
 * is a press this is told about, because nothing in the render says a press
 * happened. A window OPENING is not told: a client finishing its startup and a
 * link opening a browser window both take the keyboard with no press behind
 * them, and what says so is the window being one that was not there last
 * render. A window CLOSING is the same again read backwards — the window the
 * keyboard was in is not in this render's list, the tiling has shut over the
 * gap, and the keyboard is somewhere the pointer is not. All three are a focus
 * nothing else asked for, so all three are a focus the pointer would otherwise
 * take straight back.
 *
 * **A render late is the point rather than a compromise.** The window's box is
 * not known when the key is pressed — the press is a reduction, and where the
 * windows land is what the render after it works out — so the warp cannot be
 * part of the action. The press is remembered instead, and spent on the first
 * render that follows it.
 *
 * **And it answers the question the other way round**, which is the half the
 * warp cannot win on its own: is a window the pointer is over a window the
 * *pointer* went to? The layout moving under a stationary hand fires
 * `pointerover` exactly as crossing a window does, and the warp is a render
 * late and aimed at a box the window is still easing towards — so between
 * the press and the settle, the window under the cursor is whichever one
 * happens to be passing. A hover answered then is the desktop pointing at
 * itself. {@link Pointer.pointing} is what says so.
 */
export const usePointerWarp = ({
  domicile,
  focus,
  keyed,
  windows,
}: Options): Pointer => {
  // Refs rather than state, every one of them: none is drawn, and a pointer
  // that re-rendered the desktop on every move would re-render it sixty times
  // a second for nothing on screen.
  // Where the page last saw the pointer, and every place it has asked the
  // engine to put it that nothing has turned up at yet — see
  // {@link Pointer.pointing} for why both are kept, and why the second is a
  // list: a press can follow another before the first warp has landed, and
  // both answers are the desktop's own move.
  const pointer = useRef<Spot | undefined>(undefined);
  const sent = useRef<readonly Spot[]>([]);
  const held = useRef<Focus | undefined>(undefined);
  const open = useRef<readonly string[]>([]);

  // Something turned up at `to`: the cursor, or a window at the cursor. Which
  // of the two it was, is {@link Pointer.pointing}'s question, and answering
  // it is also what settles where the cursor has got to.
  const arrivedAt = useCallback((to: Spot): boolean => {
    const asked = sent.current.findIndex((spot) => same(spot, to));
    const seen = pointer.current;
    if (asked !== -1) {
      // A warp landed, which is the desktop's own move rather than a hand.
      // Everything asked for before it goes with it: the engine carries them
      // out in order, so a place reached is a place every earlier one was
      // superseded by — and one kept past that is a place this page would go
      // on believing the cursor to be, long after it was somewhere else.
      pointer.current = to;
      sent.current = sent.current.slice(asked + 1);
      return false;
    } else if (seen !== undefined && same(seen, to)) {
      // A window came to the pointer. Whatever was asked for is still in the
      // air: this says where the cursor is, and it is not there yet.
      return false;
    } else {
      // The pointer is somewhere neither this page saw it nor sent it, which
      // is the hand having moved — and settles every warp still outstanding,
      // because wherever they were going, the cursor is here now.
      pointer.current = to;
      sent.current = [];
      return true;
    }
  }, []);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      // Through the same question a crossing goes through, because it is the
      // same question: this is where the cursor turned out to be.
      arrivedAt([event.clientX, event.clientY]);
    };
    // On the document, which is where every pointer event over a window ends
    // up: an `<app>` is an element of this page, so the pointer the client
    // under it is being handed is this document's pointer on its way past.
    document.addEventListener("pointermove", moved);
    return () => {
      document.removeEventListener("pointermove", moved);
    };
  }, [arrivedAt]);

  // No dependency array on purpose, for `useReclaimFocus`'s reason: what this
  // reads is the render's own output — where the focus was last render and
  // where it is this one — so the render is the whole signal, and a press
  // whose render changed nothing else has to be spent all the same.
  useEffect(() => {
    // A window nobody has seen before, holding the keyboard: the one focus
    // change that announces itself in the render rather than in a press.
    const opened = focus !== undefined && !open.current.includes(focus.id);
    // And the third: the window the keyboard was in has closed, the tiling
    // has shut over it, and the keyboard has landed somewhere the pointer is
    // not — with whatever filled the gap arriving under the pointer as it
    // went. Nobody pressed anything for that one either.
    const was = held.current;
    const gone = was !== undefined && !windows.includes(was.id);
    const to =
      keyed.current || opened || gone
        ? warpTo({
            from: held.current,
            // Where the cursor is as far as this page can tell, which is
            // where it was asked to go while that is still in the air: a
            // second press before the first warp has landed must not send it
            // somewhere it is already going.
            pointer: sent.current.at(-1) ?? pointer.current,
            to: focus,
          })
        : undefined;
    held.current = focus;
    open.current = windows;
    if (to !== undefined) {
      // Written down as well as asked for. The engine moves the pointer it
      // draws and tells this page nothing about having done it, so a page that
      // waited to be told would read the next press against a place the
      // pointer has not been since.
      // In the order they were asked for, duplicates and all. A spot asked
      // for twice cannot be folded into one: the engine goes to it, away and
      // back, so the entry in between is a landing still to come — and
      // dropping the earlier of the two puts the later one behind it, where
      // the first landing to arrive gives up both. What that trades for what
      // is in {@link Pointer.pointing}.
      sent.current = [...sent.current, to].slice(-IN_FLIGHT);
      domicile.warpPointer(to);
    }
  });

  return useMemo(() => ({ pointing: arrivedAt }), [arrivedAt]);
};

/** Whether two places on the page are the same place. */
const same = (one: Spot, other: Spot): boolean =>
  one[0] === other[0] && one[1] === other[1];
