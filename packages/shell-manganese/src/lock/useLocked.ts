import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useEffect, useState } from "react";

/**
 * Whether this desk is locked.
 *
 * **Pushed rather than asked for, and held by the compositor rather than here.**
 * This page does not decide the lock and cannot: input on this system is
 * forwarded by this page and injected into a Wayland seat by the compositor, and
 * a locked desk is that injection not happening. So what this hook holds is the
 * compositor's answer and nothing else — there is no local `setLocked` for a
 * click to reach, which is what makes the lock survive a reload of this page and
 * an engine that died and came back.
 *
 * `false` until the compositor has said otherwise, which is a moment rather than
 * a state worth drawing: it says where the desk stands as this page connects, so
 * a page that reloaded over a locked desk is told inside the handshake. Starting
 * from `true` would put a lock screen over every desktop for the length of one —
 * including the ones with no passphrase configured, which can never be asked for
 * one and would have nothing to clear it.
 */
export const useLocked = (domicile: DomicileClient): boolean => {
  const [locked, setLocked] = useState(false);

  // Registered once and for the life of the shell, like `useClipboard`'s: `on`
  // is a single slot whose hold delivers whatever arrived before it, and the
  // message this is here for is exactly the one that arrives before the first
  // render is over.
  useEffect(() => {
    domicile.on("locked", (message) => {
      setLocked(message.locked);
    });
  }, [domicile]);

  return locked;
};
