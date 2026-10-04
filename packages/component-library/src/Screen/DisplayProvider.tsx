import type { CSSProperties, PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useState } from "react";

import type { Display, DisplaySource } from "./display-source";

/**
 * The desktop's displays, for `<Screen>` and {@link useDisplays}.
 *
 * Holds an object, not the list, so `undefined` means "no provider" and
 * `{ displays: undefined }` means "not described yet".
 */
const DisplayContext = createContext<
  { displays: readonly Display[] | undefined } | undefined
>(undefined);

/**
 * Provides the host's display list. Mount one around the shell's root.
 *
 * Reads the source's current list as well as subscribing, since the host may
 * not send another update for a long time. `source` must be stable; a new
 * identity is treated as a new connection. See {@link DisplaySource}.
 */
export const DisplayProvider = ({
  children,
  source,
}: PropsWithChildren<{ source: DisplaySource }>) => {
  const [displays, setDisplays] = useState(source.displays);

  useEffect(() => {
    // `useState` covers the first render; this covers a changed `source`.
    setDisplays(source.displays);
    return source.onDisplays(setDisplays);
  }, [source]);

  // Not memoized: the provider rarely re-renders, so it isn't worth it.
  return (
    <DisplayContext.Provider value={{ displays }}>
      {children}
    </DisplayContext.Provider>
  );
};

/**
 * The desktop's displays, or `undefined` until the host describes them. An
 * empty list means no screens.
 *
 * Throws without a {@link DisplayProvider}.
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
 * The page-space `left`, `top`, `width` and `height` of display `name`, for
 * placing an element on one monitor of a page that spans several.
 *
 * Returns `undefined` (the whole page) for no name, which needs no provider,
 * and for an unknown name. An unplugged monitor disappears a render before
 * the shell moves off it, so that must not throw.
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
