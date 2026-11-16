// The stand-in for Electron's `session`: one per partition, each with its own
// protocol handlers, webRequest listeners, cookies, storage and permission
// handlers. Each is a partition inside the app's own in the engine,
// so no session reaches another app's storage. See "Requests" in
// docs/architecture/ELECTRON-APPS.md.

import { EventEmitter } from "node:events";

import type { DisplayMediaRequestHandler } from "./desktop-capturer";
import { setDisplayMediaRequestHandler } from "./desktop-capturer";
import type {
  createPermissions,
  PermissionCheckHandler,
  PermissionRequestHandler,
  Permissions,
} from "./permissions";
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
export class Session extends EventEmitter {
  readonly cookies: Cookies;
  readonly #calls: SessionCalls;
  readonly #permissions: Permissions;

  constructor(
    partition: string,
    readonly protocol: Protocol,
    readonly webRequest: WebRequest,
    calls: SessionCalls,
    permissions: Permissions,
  ) {
    super();
    partitions.set(this, partition);
    this.cookies = calls.cookies;
    this.#calls = calls;
    this.#permissions = permissions;
  }

  /**
   * The engine runs a session's service workers itself and doesn't tell the
   * app of them yet: none are running as far as the app can see, and no
   * worker events come.
   */
  readonly serviceWorkers = Object.assign(new EventEmitter(), {
    getAllRunning: () => ({}),
    getFromVersionID: (_versionId: number) => null,
    getInfoFromVersionID: (_versionId: number) => null,
    getWorkerFromVersionID: (_versionId: number) => undefined,
    startWorkerForScope: (scope: string) =>
      Promise.reject(
        new Error(
          `Domicile's engine can't start a service worker for the app yet (${scope})`,
        ),
      ),
  });

  /**
   * The engine keeps no net log for the app yet: logging never starts, and
   * asking it to says so.
   */
  readonly netLog = {
    currentlyLogging: false,
    startLogging: (_path: string, _options?: unknown) =>
      Promise.reject(
        new Error("Domicile's engine doesn't keep a net log for the app yet"),
      ),
    stopLogging: () => Promise.resolve(),
  };

  #spellCheck = {
    enabled: true,
    languages: ["en-US"],
    words: new Set<string>(),
  };
  #preloads: string[] = [];

  /**
   * The engine checks spelling in its pages as the desktop's browser does,
   * so what the app sets here is kept for it to read back, not applied.
   */
  setSpellCheckerEnabled(enabled: boolean) {
    this.#spellCheck.enabled = enabled;
  }

  isSpellCheckerEnabled() {
    return this.#spellCheck.enabled;
  }

  setSpellCheckerLanguages(languages: readonly string[]) {
    this.#spellCheck.languages = [...languages];
  }

  getSpellCheckerLanguages() {
    return [...this.#spellCheck.languages];
  }

  get availableSpellCheckerLanguages() {
    return [...this.#spellCheck.languages];
  }

  setSpellCheckerDictionaryDownloadURL(_url: string): void {
    // Nothing to do on Domicile: see above.
  }

  addWordToSpellCheckerDictionary(word: string) {
    this.#spellCheck.words.add(word);
    return true;
  }

  removeWordFromSpellCheckerDictionary(word: string) {
    return this.#spellCheck.words.delete(word);
  }

  listWordsInSpellCheckerDictionary() {
    return Promise.resolve([...this.#spellCheck.words]);
  }

  /**
   * A request from the main process with this session's cookies, as
   * Electron's goes out with them, keeping the cookies it sets.
   */
  async fetch(input: string | Request, init?: RequestInit) {
    const request =
      typeof input === "string"
        ? new Request(input, init)
        : new Request(input, init);
    if (!request.headers.has("cookie")) {
      const cookies = await this.cookies.get({ url: request.url });
      if (cookies.length > 0) {
        request.headers.set(
          "cookie",
          cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
        );
      }
    }
    const response = await fetch(request);
    for (const line of response.headers.getSetCookie()) {
      await this.cookies.set(cookieFrom(request.url, line));
    }
    return response;
  }

  // The engine connects directly, with no proxy from the app, and keeps its
  // own connection pools and caches.
  resolveProxy(_url: string) {
    return Promise.resolve("DIRECT");
  }

  setProxy(_config: unknown) {
    return Promise.resolve();
  }

  forceReloadProxyConfig() {
    return Promise.resolve();
  }

  closeAllConnections() {
    return Promise.resolve();
  }

  clearHostResolverCache() {
    return Promise.resolve();
  }

  /**
   * The engine signs in with NTLM or Kerberos only where its own policy
   * allows, as Chrome does, so the app's list changes nothing yet. Slack sets
   * one as it starts.
   */
  allowNTLMCredentialsForDomains(_domains: string): void {
    // Nothing to do on Domicile: see above.
  }

  /** The engine writes a page's storage out itself. */
  flushStorageData(): void {
    // Nothing to do on Domicile: see above.
  }

  getCacheSize() {
    return Promise.resolve(0);
  }

  /** A hint to open a connection early; the engine connects when the page asks. */
  preconnect(_options: { url: string; numSockets?: number }): void {
    // Nothing to do on Domicile: see above.
  }

  isPersistent() {
    const partition = partitions.get(this) ?? "";
    return partition === "" || partition.startsWith("persist:");
  }

  /** Kept for the app to read; the engine runs only each window's own preload. */
  setPreloads(preloads: readonly string[]) {
    this.#preloads = [...preloads];
  }

  getPreloads() {
    return [...this.#preloads];
  }

  // The engine's own checks stand: an app's handlers for certificates and
  // devices aren't asked, so nothing is let through that wouldn't be.
  setCertificateVerifyProc(_proc: unknown): void {
    // Nothing to do on Domicile: see above.
  }
  setDevicePermissionHandler(_handler: unknown): void {
    // Nothing to do on Domicile: see above.
  }
  setBluetoothPairingHandler(_handler: unknown): void {
    // Nothing to do on Domicile: see above.
  }
  setUSBProtectedClassesHandler(_handler: unknown): void {
    // Nothing to do on Domicile: see above.
  }

  setPermissionRequestHandler(handler: PermissionRequestHandler | null) {
    this.#permissions.setPermissionRequestHandler(handler);
  }

  setPermissionCheckHandler(handler: PermissionCheckHandler | null) {
    this.#permissions.setPermissionCheckHandler(handler);
  }

  /** The desktop's picker answers instead: see desktop-capturer.ts. */
  setDisplayMediaRequestHandler(
    handler: DisplayMediaRequestHandler | null,
    options?: { useSystemPicker?: boolean },
  ) {
    setDisplayMediaRequestHandler(handler, options);
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
 * whose webRequest listeners are `webRequests`, whose session calls go
 * through `calls` and whose permission handlers are `permissions`.
 */
export const createSessions = (
  protocols: ReturnType<typeof createProtocols>,
  webRequests: ReturnType<typeof createWebRequests>,
  calls: ReturnType<typeof createSessionCalls>,
  permissions: ReturnType<typeof createPermissions>,
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
        permissions.forSession(partition),
      );
      made.set(partition, session);
      return session;
    } else {
      return found;
    }
  };
  return { defaultSession: fromPartition(""), fromPartition };
};

/** The `cookies.set` details for a `Set-Cookie` line a response to `url` had. */
export const cookieFrom = (url: string, line: string) => {
  const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
  const split = pair.indexOf("=");
  const details: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
  } = {
    name: pair.slice(0, split),
    url,
    value: pair.slice(split + 1),
  };
  for (const attribute of attributes) {
    const [key = "", value = ""] = attribute.split("=");
    switch (key.toLowerCase()) {
      case "domain":
        details.domain = value;
        break;
      case "path":
        details.path = value;
        break;
      case "secure":
        details.secure = true;
        break;
      case "httponly":
        details.httpOnly = true;
        break;
      case "max-age":
        details.expirationDate = Date.now() / 1000 + Number(value);
        break;
      case "expires":
        details.expirationDate ??= Date.parse(value) / 1000;
        break;
      case "samesite":
        details.sameSite =
          value.toLowerCase() === "none"
            ? "no_restriction"
            : (value.toLowerCase() as "lax" | "strict");
        break;
    }
  }
  return details;
};
