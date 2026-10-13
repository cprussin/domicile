import type { ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useState } from "react";

import type { Rect } from "./rect";

/**
 * Where each key's part was drawn as it went, for a part taking over from it
 * in the same commit. See `useSettling`.
 */
type Handoffs = Map<string, Rect>;

const HandoffContext = createContext<Handoffs | undefined>(undefined);

/**
 * Lets a part new in a commit ease from where a part it replaces was drawn,
 * such as a strip handed to the next open tab.
 *
 * React runs every removed part's cleanup, then every new part's layout
 * effect, then this one's, so a handoff lasts exactly the commit that made it.
 * Outside it, parts take over from nothing.
 */
export const SettleHandoffs = ({ children }: { children: ReactNode }) => {
  const [handoffs] = useState<Handoffs>(() => new Map());
  useLayoutEffect(() => {
    handoffs.clear();
  });
  return (
    <HandoffContext.Provider value={handoffs}>
      {children}
    </HandoffContext.Provider>
  );
};

/** The handoffs of the commit in progress, if inside {@link SettleHandoffs}. */
export const useHandoffs = (): Handoffs | undefined =>
  useContext(HandoffContext);
