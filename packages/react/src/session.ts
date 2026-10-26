import { useDomicile } from "./domicile-provider";
import { useWatch } from "./use-watch";

/** Whether the user stepped away, or `undefined` until the compositor says. */
export const useIdle = (): boolean | undefined => {
  const { session } = useDomicile();
  return useWatch(session, "idlechange", () => session.idle);
};

/** Whether the desk is locked, or `undefined` until the compositor says. */
export const useLocked = (): boolean | undefined => {
  const { session } = useDomicile();
  return useWatch(session, "lockchange", () => session.locked);
};
