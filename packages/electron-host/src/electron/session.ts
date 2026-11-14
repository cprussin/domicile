// The stand-in for Electron's `session`: one per partition, each with its own
// protocol handlers. Each is a partition inside the app's own in the engine,
// so no session reaches another app's storage. See "Requests" in
// docs/architecture/ELECTRON-APPS.md.

import type { createProtocols, Protocol } from "./protocol";

const partitions = new WeakMap<Session, string>();

/** Electron's `Session`, as far as the host has it. */
export class Session {
  constructor(
    partition: string,
    readonly protocol: Protocol,
  ) {
    partitions.set(this, partition);
  }
}

/** The Electron partition `session` was made for, "" the app's own. */
export const sessionPartition = (session: Session) => {
  const partition = partitions.get(session);
  if (partition === undefined) {
    throw new Error("every Session is made by createSessions");
  } else {
    return partition;
  }
};

/** Electron's `session` module for an app whose protocols are `protocols`. */
export const createSessions = (
  protocols: ReturnType<typeof createProtocols>,
) => {
  const made = new Map<string, Session>();
  const fromPartition = (partition: string) => {
    const found = made.get(partition);
    if (found === undefined) {
      const session = new Session(partition, protocols.forSession(partition));
      made.set(partition, session);
      return session;
    } else {
      return found;
    }
  };
  return { defaultSession: fromPartition(""), fromPartition };
};
