import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useCallback, useEffect, useRef } from "react";

import type { Focus, Spot } from "./pointer-warp";
import { warpTo } from "./pointer-warp";

type Options = {
  domicile: DomicileClient;
  /** The window the keyboard is in and the box it is drawn in, or none. */
  focus: Focus | undefined;
  /**
   * Every window the desktop has, by id.
   *
   * Read for one thing: whether the window the keyboard is on is one that was
   * not there last render, which is a window that has just opened.
   */
  windows: readonly string[];
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
 * **Two of them are the desktop's own, and they arrive differently.** A key is
 * a press this is told about, because nothing in the render says a press
 * happened. A window OPENING is not told: a client finishing its startup and a
 * link opening a browser window both take the keyboard with no press behind
 * them, and what says so is the window being one that was not there last
 * render. Both are a focus nothing else asked for, so both are a focus the
 * pointer would otherwise take straight back.
 *
 * **A render late is the point rather than a compromise.** The window's box is
 * not known when the key is pressed — the press is a reduction, and where the
 * windows land is what the render after it works out — so the warp cannot be
 * part of the action. The press is remembered instead, and spent on the first
 * render that follows it.
 *
 * @returns What the keyboard path calls before it acts. Nothing else may: a
 *   focus the pointer itself moved is one this must leave alone, or the
 *   desktop chases its own cursor.
 */
export const usePointerWarp = ({
  domicile,
  focus,
  windows,
}: Options): (() => void) => {
  // Refs rather than state, all four: none of them is drawn, and a pointer
  // that re-rendered the desktop on every move would re-render it sixty times
  // a second for nothing on screen.
  const pointer = useRef<Spot | undefined>(undefined);
  const pressed = useRef(false);
  const was = useRef<Focus | undefined>(undefined);
  const open = useRef<readonly string[]>([]);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      pointer.current = [event.clientX, event.clientY];
    };
    // On the document, which is where every pointer event over a window ends
    // up: an `<app>` is an element of this page, so the pointer the client
    // under it is being handed is this document's pointer on its way past.
    document.addEventListener("pointermove", moved);
    return () => {
      document.removeEventListener("pointermove", moved);
    };
  }, []);

  // No dependency array on purpose, for `useReclaimFocus`'s reason: what this
  // reads is the render's own output — where the focus was last render and
  // where it is this one — so the render is the whole signal, and a press
  // whose render changed nothing else has to be spent all the same.
  useEffect(() => {
    // A window nobody has seen before, holding the keyboard: the one focus
    // change that announces itself in the render rather than in a press.
    const opened = focus !== undefined && !open.current.includes(focus.id);
    const to =
      pressed.current || opened
        ? warpTo({ from: was.current, pointer: pointer.current, to: focus })
        : undefined;
    pressed.current = false;
    was.current = focus;
    open.current = windows;
    if (to !== undefined) {
      // Written down as well as asked for. The engine moves the pointer it
      // draws and tells this page nothing about having done it, so a page that
      // waited to be told would read the next press against a place the
      // pointer has not been since.
      pointer.current = to;
      domicile.warpPointer(to);
    }
  });

  return useCallback(() => {
    pressed.current = true;
  }, []);
};
