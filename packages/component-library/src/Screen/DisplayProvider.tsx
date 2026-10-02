import type { CSSProperties, PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useState } from "react";

import type { Display, DisplaySource } from "./display-source";

/**
 * The desktop below it, for every `<Screen>` and every {@link useDisplays}.
 *
 * `undefined` distinguishes "no provider" from "a provider that has not been
 * told yet", which is why the context holds a box rather than the list: a
 * desktop the host has not described and a desktop of no screens are both
 * legitimate, and only the first is a wiring bug when it reaches a consumer.
 */
const DisplayContext = createContext<
  { displays: readonly Display[] | undefined } | undefined
>(undefined);

/**
 * Holds the desktop the host described, for the `<Screen>`s below.
 *
 * One provider per page, mounted around the shell's root. The host describes
 * the desktop on connecting and again whenever it changes, latest wins — so
 * this reads what the source has already been told as well as registering for
 * what it says next. A provider that only listened would render an empty
 * desktop from mounting until the next change, which on a desktop nobody is
 * resizing is for good.
 *
 * `source` is read on mount and re-read whenever its identity changes: it is
 * the connection, and a new one is a new desktop, which may already have been
 * described. It has to be as stable as a connection — see {@link DisplaySource}.
 */
export const DisplayProvider = ({
  children,
  source,
}: PropsWithChildren<{ source: DisplaySource }>) => {
  const [displays, setDisplays] = useState(source.displays);

  useEffect(() => {
    // Seeded by `useState` on the first render, so the first paint already has
    // the desktop; assigned again here because a *changed* source is a new
    // connection, and `useState`'s initializer does not run twice.
    setDisplays(source.displays);
    return source.onDisplays(setDisplays);
  }, [source]);

  // A fresh box per render, which re-renders every consumer whenever this
  // provider renders — the desktop is read during layout and changes about as
  // often as a monitor is plugged in, so memoizing it would buy nothing and
  // cost a dependency array to keep honest.
  return (
    <DisplayContext.Provider value={{ displays }}>
      {children}
    </DisplayContext.Provider>
  );
};

/**
 * The displays making up the desktop, or `undefined` while the host has yet to
 * describe it. An empty list is a desktop with no screens, which is a different
 * thing and renders differently.
 *
 * Throws when nothing is listening: a display consumer is only ever mounted in
 * an app that mounted a {@link DisplayProvider}, so a missing one is a wiring
 * bug to surface rather than a page that silently lays out against nothing.
 */
export const useDisplays = (): readonly Display[] | undefined => {
  const held = useContext(DisplayContext);
  if (held === undefined) {
    throw new Error("useDisplays must be used within a <DisplayProvider>");
  } else {
    return held.displays;
  }
};

/**
 * Where on the page the display `name` is, as the physical `left`, `top`,
 * `width` and `height` of an element laid out over it — what a dialog's
 * viewport takes to sit on one monitor of a page that spans several, rather
 * than centered on all of them. `<Screen>` places its regions the same way.
 *
 * `undefined` — the page — for no name, which needs no provider; and for a
 * name no display carries: a monitor unplugged under an open dialog is gone a
 * render before the shell has moved off it, and that render should not take
 * the page down.
 */
export const useScreenRegion = (
  name: string | undefined,
): CSSProperties | undefined => {
  const held = useContext(DisplayContext);
  if (name === undefined) {
    return undefined;
  } else if (held === undefined) {
    throw new Error("useScreenRegion must be used within a <DisplayProvider>");
  } else {
    const display = held.displays?.find((display) => display.name === name);
    return display === undefined
      ? undefined
      : {
          height: `${String(display.size[1])}px`,
          left: `${String(display.position[0])}px`,
          top: `${String(display.position[1])}px`,
          width: `${String(display.size[0])}px`,
        };
  }
};
