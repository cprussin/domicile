import { useEffect } from "react";

import type { LockingWindows } from "./pointer-lock";
import { followPointerLock } from "./pointer-lock";

/**
 * Locks the pointer for a game or VM viewer that asked, while its window has
 * the keyboard. See {@link followPointerLock}.
 */
export const usePointerLock = (windows: LockingWindows) => {
  useEffect(() => followPointerLock(windows, document), [windows]);
};
