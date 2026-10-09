import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Focus, Shown, Spot } from "./pointer-warp";
import { overAnother, warpTo } from "./pointer-warp";
import type { Rect } from "./rect";
import type { WindowState } from "./window-state";

/**
 * The most pending warp targets kept.
 *
 * Only warps that never report a landing pile up: the engine declined them,
 * or the pointer landed in a guest page whose events this shell cannot see.
 * Dropping the oldest means a late landing there reads as a user move.
 */
const IN_FLIGHT = 4;

/**
 * How far, in page pixels, a pointer event can be from a spot and still be at
 * it.
 *
 * At a fractional scale the engine floors a warp into device pixels, then
 * floors the landing back into DIPs, so it arrives up to 1.5 page pixels off
 * (at scale 1.2).
 */
const NEAR = 2;

type Options = {
  domicile: DomicileHost;
  /** The focused window and its box, or none. */
  focus: Focus | undefined;
  /**
   * The desk's count of key presses (`WindowState.pressed`). A new value means
   * this render answers a key press. Pointer-driven focus never increments it,
   * so the warp does not chase the pointer. The count is per desk because the
   * press is answered by whichever monitor took focus.
   */
  pressed: WindowState["pressed"];
  /** Every window the screens show, with its box. */
  shown: readonly Shown[];
  /** Every window id, used to detect newly opened windows. */
  windows: readonly string[];
};

/** What the desktop asks about the pointer. */
export type Pointer = {
  /**
   * Whether a pointer event at `at` means the user moved the pointer there.
   *
   * Decided by position, not a flag: a crossing fires `pointerover` before
   * `pointermove`, so a flag cleared on move would swallow it. An event within
   * `NEAR` of the last seen position or of a pending warp target is a window
   * arriving under the pointer. Anything farther is the user and clears pending warps. Fails
   * open while the pointer position is unknown.
   *
   * A target sent twice with another in between is ambiguous if the engine
   * coalesced the middle warp. This keeps the earlier entry, so a crossing that
   * lands exactly on a window's center can be misread as a warp. The crossed
   * window then does not get focus until the pointer leaves that `<app>` and
   * re-enters. The other choice would hand focus to windows the user never
   * pointed at.
   */
  pointing: (at: Spot) => boolean;
};

/**
 * Warps the pointer to follow keyboard focus (`mouse_warping container`).
 *
 * The decision is in `pointer-warp.ts`. This hook detects which focus changes
 * the desktop made, tracks the pointer, and asks the engine to warp once the
 * new layout is known, one render after the change.
 *
 * Three focus changes count as the desktop's: a key press (signaled by
 * `pressed`), a newly opened window taking focus, and the focused window
 * closing. A new tab or the next tab in the same box is skipped, since nothing
 * moved under the pointer. A newly opened window warps only when the pointer is
 * over another window, which would otherwise take focus from it.
 *
 * It also reports whether a pointer event is the user's: windows moving under
 * a still pointer fire `pointerover` too. See {@link Pointer.pointing}.
 */
export const usePointerWarp = ({
  domicile,
  focus,
  pressed,
  shown,
  windows,
}: Options): Pointer => {
  // Refs, not state: none of this is drawn, and pointer moves must not
  // re-render the desktop.
  // `sent` holds every warp target not yet landed, since a second press can
  // come before the first warp lands. See {@link Pointer.pointing}.
  const pointer = useRef<Spot | undefined>(undefined);
  const sent = useRef<readonly Spot[]>([]);
  const held = useRef<Focus | undefined>(undefined);
  const open = useRef<readonly string[]>([]);
  // Start from the current count: a desk drawn mid-session has no press to
  // answer.
  const answered = useRef(pressed);

  // Records an arrival at `to` and returns whether the user moved the pointer
  // there. See {@link Pointer.pointing}.
  const arrivedAt = useCallback((to: Spot): boolean => {
    const asked = sent.current.findIndex((spot) => same(spot, to));
    const seen = pointer.current;
    if (asked !== -1) {
      // A warp landed. The engine runs warps in order, so earlier ones are
      // superseded.
      pointer.current = to;
      sent.current = sent.current.slice(asked + 1);
      return false;
    } else if (seen !== undefined && same(seen, to)) {
      // A window moved under the still pointer. Pending warps stay pending.
      return false;
    } else {
      // The hand moved the pointer. That supersedes every pending warp.
      pointer.current = to;
      sent.current = [];
      return true;
    }
  }, []);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      // A move is an arrival too: it says where the cursor is.
      arrivedAt([event.clientX, event.clientY]);
    };
    // On the document: pointer events over an `<app>` bubble through this
    // page.
    document.addEventListener("pointermove", moved);
    return () => {
      document.removeEventListener("pointermove", moved);
    };
  }, [arrivedAt]);

  // No dependency array, as in `useReclaimFocus`: it compares this render's
  // focus with the last, and must spend a press even if nothing else changed.
  useEffect(() => {
    const was = held.current;
    // A newly opened window took focus. Skip when it opened as a tab in the
    // focused window's box: nothing moved under the pointer.
    const opened =
      focus?.id !== undefined &&
      !open.current.includes(focus.id) &&
      !(was !== undefined && sameBox(was.box, focus.box));
    // The focused window closed and focus moved elsewhere. Skip when the next
    // tab took its box: nothing moved under the pointer.
    const gone =
      was?.id !== undefined &&
      !windows.includes(was.id) &&
      !sameBox(was.box, focus?.box);
    const keyed = pressed !== answered.current;
    answered.current = pressed;
    // The pending target, if any, so a second press before the first warp
    // lands is measured from where the cursor is going.
    const at = sent.current.at(-1) ?? pointer.current;
    const to =
      keyed || gone || (opened && overAnother(shown, focus, at))
        ? warpTo({ from: was, pointer: at, to: focus })
        : undefined;
    held.current = focus;
    open.current = windows;
    if (to !== undefined) {
      // Record it now: the engine does not report when the warp lands.
      // Keep duplicates in order: a spot sent twice is landed on twice, and
      // folding them would let the first landing clear both.
      sent.current = [...sent.current, to].slice(-IN_FLIGHT);
      domicile.warpPointer(to[0], to[1]);
    }
  });

  return useMemo(() => ({ pointing: arrivedAt }), [arrivedAt]);
};

/** Whether two places on the page are the same place, give or take rounding. */
const same = (one: Spot, other: Spot): boolean =>
  Math.abs(one[0] - other[0]) < NEAR && Math.abs(one[1] - other[1]) < NEAR;

/** Whether `other` is the box `one` is, or `false` for no box at all. */
const sameBox = (one: Rect, other: Rect | undefined): boolean =>
  other !== undefined &&
  one.x === other.x &&
  one.y === other.y &&
  one.width === other.width &&
  one.height === other.height;
