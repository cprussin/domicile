// The stand-in for Electron's `session`: one per partition, each with its own
// protocol handlers, webRequest listeners, cookies and storage. Each is a partition inside the app's own in the engine,
// so no session reaches another app's storage. See "Requests" in
// docs/architecture/ELECTRON-APPS.md.

import type { createProtocols, Protocol } from "./protocol";
import type {
  ClearStorageDataOptions,
  Cookies,
  createSessionCalls,
  SessionCalls,
} from "./session-calls";
import type { createWebRequests, WebRequest } from "./web-request";

const partitions = new WeakMap<Session, string>();

/** Electron's `Session`, as far as the host has it. */
export class Session {
  readonly cookies: Cookies;
  readonly #calls: SessionCalls;

  constructor(
    partition: string,
    readonly protocol: Protocol,
    readonly webRequest: WebRequest,
    calls: SessionCalls,
  ) {
    partitions.set(this, partition);
    this.cookies = calls.cookies;
    this.#calls = calls;
  }

  clearStorageData(options?: ClearStorageDataOptions) {
    return this.#calls.clearStorageData(options);
  }

  clearCache() {
    return this.#calls.clearCache();
  }

  setUserAgent(userAgent: string, acceptLanguages?: string) {
    this.#calls.setUserAgent(userAgent, acceptLanguages);
  }

  getUserAgent() {
    return this.#calls.getUserAgent();
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

/**
 * Electron's `session` module for an app whose protocols are `protocols`,
 * whose webRequest listeners are `webRequests` and whose session calls go
 * through `calls`.
 */
export const createSessions = (
  protocols: ReturnType<typeof createProtocols>,
  webRequests: ReturnType<typeof createWebRequests>,
  calls: ReturnType<typeof createSessionCalls>,
) => {
  const made = new Map<string, Session>();
  const fromPartition = (partition: string) => {
    const found = made.get(partition);
    if (found === undefined) {
      const session = new Session(
        partition,
        protocols.forSession(partition),
        webRequests.forSession(partition),
        calls.forSession(partition),
      );
      made.set(partition, session);
      return session;
    } else {
      return found;
    }
  };
  return { defaultSession: fromPartition(""), fromPartition };
};
