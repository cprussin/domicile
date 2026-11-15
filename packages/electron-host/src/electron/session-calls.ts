// The parts of Electron's `Session` the engine keeps: its cookies, its
// storage and cache, and its user agent. Each is a `session_call` the engine
// answers with a `session_result`. See "Requests" in
// docs/architecture/ELECTRON-APPS.md.

/** The calls the host makes on a session, by their names on the wire. */
export type SessionCallMessage = {
  readonly type: "session_call";
  readonly call: number;
  readonly session: string;
  readonly method:
    | "cookies_get"
    | "cookies_set"
    | "cookies_remove"
    | "cookies_flush"
    | "clear_storage_data"
    | "clear_cache"
    | "set_user_agent";
  readonly [argument: string]: unknown;
};

/** The engine's answer to a session call. */
export type SessionResult =
  | {
      readonly type: "session_result";
      readonly call: number;
      readonly result: unknown;
    }
  | {
      readonly type: "session_result";
      readonly call: number;
      readonly error: string;
    };

/** Electron's `CookiesGetFilter`. */
export type CookiesGetFilter = {
  readonly url?: string;
  readonly name?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly session?: boolean;
};

/** Electron's `CookiesSetDetails`. */
export type CookiesSetDetails = {
  readonly url: string;
  readonly name?: string;
  readonly value?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly expirationDate?: number;
  readonly sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
};

/** Electron's `Cookie`, as the engine gives it. */
export type Cookie = {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly hostOnly?: boolean;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly session?: boolean;
  readonly expirationDate?: number;
  readonly sameSite?: string;
};

/** Electron's `Cookies`. */
export type Cookies = {
  readonly get: (filter: CookiesGetFilter) => Promise<Cookie[]>;
  readonly set: (details: CookiesSetDetails) => Promise<void>;
  readonly remove: (url: string, name: string) => Promise<void>;
  readonly flushStore: () => Promise<void>;
};

/** Electron's `ClearStorageDataOptions`; `quotas` has no meaning here. */
export type ClearStorageDataOptions = {
  readonly origin?: string;
  readonly storages?: readonly string[];
  readonly quotas?: readonly string[];
};

/** What one session has of these calls. */
export type SessionCalls = {
  readonly cookies: Cookies;
  readonly clearStorageData: (
    options?: ClearStorageDataOptions,
  ) => Promise<void>;
  readonly clearCache: () => Promise<void>;
  readonly setUserAgent: (userAgent: string, acceptLanguages?: string) => void;
  /** The user agent the app set; "" until it sets one. */
  readonly getUserAgent: () => string;
};

/** Drops the keys whose value is undefined, so the line leaves them out. */
const defined = (fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

/**
 * The session calls of an app whose requests to the engine go through
 * `send`; `hear` takes the engine's answers.
 */
export const createSessionCalls = (
  send: (message: SessionCallMessage) => void,
) => {
  const waiting = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  let next = 1;

  const call = (
    session: string,
    method: SessionCallMessage["method"],
    args: Record<string, unknown> = {},
  ) =>
    new Promise<unknown>((resolve, reject) => {
      const number = next++;
      waiting.set(number, { reject, resolve });
      send({ ...args, call: number, method, session, type: "session_call" });
    });

  const nothing = (promise: Promise<unknown>) => promise.then(() => undefined);

  const forSession = (session: string): SessionCalls => {
    let userAgent = "";
    return {
      clearCache: () => nothing(call(session, "clear_cache")),
      clearStorageData: (options = {}) =>
        nothing(
          call(
            session,
            "clear_storage_data",
            defined({ origin: options.origin, storages: options.storages }),
          ),
        ),
      cookies: {
        flushStore: () => nothing(call(session, "cookies_flush")),
        get: async (filter) =>
          (await call(session, "cookies_get", {
            filter: defined({
              domain: filter.domain,
              http_only: filter.httpOnly,
              name: filter.name,
              path: filter.path,
              secure: filter.secure,
              session: filter.session,
              url: filter.url,
            }),
          })) as Cookie[],
        remove: (url, name) =>
          nothing(call(session, "cookies_remove", { name, url })),
        set: (details) =>
          nothing(
            call(session, "cookies_set", {
              details: defined({
                domain: details.domain,
                expiration_date: details.expirationDate,
                http_only: details.httpOnly,
                name: details.name,
                path: details.path,
                same_site: details.sameSite,
                secure: details.secure,
                url: details.url,
                value: details.value,
              }),
            }),
          ),
      },
      getUserAgent: () => userAgent,
      setUserAgent: (agent) => {
        userAgent = agent;
        // Electron's is synchronous; a refusal is the engine's bug, and its
        // rejection goes unhandled, loudly.
        void call(session, "set_user_agent", { user_agent: agent });
      },
    };
  };

  /** Settles the call `result` answers. */
  const hear = (result: SessionResult) => {
    const found = waiting.get(result.call);
    if (found === undefined) {
      throw new Error(
        `the engine answered session call ${result.call}, which nothing waits for`,
      );
    }
    waiting.delete(result.call);
    if ("error" in result) {
      found.reject(new Error(result.error));
    } else {
      found.resolve(result.result);
    }
  };

  return { forSession, hear };
};
