// The stand-in for Electron's `protocol`: each session's handlers for the
// requests its pages make, answered over the engine. See "Requests" in
// docs/architecture/ELECTRON-APPS.md.

import { fileURLToPath } from "node:url";

/** What the host asks the engine about a session's protocols. */
export type ProtocolRequest =
  | {
      readonly type: "handle_protocol" | "unhandle_protocol";
      readonly session: string;
      readonly scheme: string;
    }
  | {
      readonly type: "protocol_response";
      readonly request: number;
      readonly status: number;
      readonly headers: [string, string][];
      readonly body: string;
    }
  | {
      readonly type: "protocol_response";
      readonly request: number;
      readonly status: number;
      readonly headers: [string, string][];
      readonly file: string;
    }
  | {
      readonly type: "protocol_response";
      readonly request: number;
      readonly status: number;
      readonly headers: [string, string][];
      readonly stream: true;
    }
  | {
      readonly type: "protocol_response";
      readonly request: number;
      readonly error: string;
    }
  | {
      readonly type: "protocol_data";
      readonly request: number;
      readonly data: string;
    }
  | {
      readonly type: "protocol_end";
      readonly request: number;
      readonly error?: string;
    };

/** A page's request in a scheme its session handles, as the engine sends it. */
export type IncomingRequest = {
  readonly request: number;
  readonly session: string;
  readonly url: string;
  readonly method: string;
  readonly headers: [string, string][];
  /** Base64, when the request has a body. */
  readonly body?: string | undefined;
};

export type ProtocolHandler = (
  request: Request,
) => Response | Promise<Response>;

/** Electron's `Protocol`, one per session. */
export type Protocol = {
  readonly handle: (scheme: string, handler: ProtocolHandler) => void;
  readonly unhandle: (scheme: string) => void;
  readonly isProtocolHandled: (scheme: string) => boolean;
};

/**
 * The protocols of an app's sessions, named by Electron partition ("" the
 * app's own). Every session serves `file:` from the file system, as Electron
 * does, until the app handles `file:` itself. `send` asks the engine.
 */
export const createProtocols = (send: (request: ProtocolRequest) => void) => {
  const sessions = new Map<string, Map<string, ProtocolHandler>>();

  const forSession = (session: string) => {
    const handlers =
      sessions.get(session) ??
      (() => {
        const made = new Map<string, ProtocolHandler>();
        sessions.set(session, made);
        send({ scheme: "file", session, type: "handle_protocol" });
        return made;
      })();
    const protocol: Protocol = {
      handle: (scheme, handler) => {
        if (handlers.has(scheme)) {
          throw new Error(`Failed to register protocol: ${scheme}`);
        }
        handlers.set(scheme, handler);
        // file: is handled from the start.
        if (scheme !== "file") {
          send({ scheme, session, type: "handle_protocol" });
        }
      },
      isProtocolHandled: (scheme) => scheme === "file" || handlers.has(scheme),
      unhandle: (scheme) => {
        if (handlers.delete(scheme) && scheme !== "file") {
          send({ scheme, session, type: "unhandle_protocol" });
        }
      },
    };
    return withLegacyProtocols(protocol);
  };

  /** Answers `incoming` with its session's handler, or why there is none. */
  const answer = async (incoming: IncomingRequest) => {
    const { request } = incoming;
    const scheme = new URL(incoming.url).protocol.slice(0, -1);
    if (scheme === "file" && !sessions.get(incoming.session)?.has("file")) {
      // A file: URL naming another host has no path here.
      let path: string;
      try {
        path = fileURLToPath(incoming.url);
      } catch (error) {
        send({ error: whyFailed(error), request, type: "protocol_response" });
        return;
      }
      // The engine reads it, ranges and all.
      send({
        file: path,
        headers: [],
        request,
        status: 200,
        type: "protocol_response",
      });
      return;
    }
    const handler = sessions.get(incoming.session)?.get(scheme);
    if (handler === undefined) {
      // The app unhandled the scheme as the page asked.
      send({
        error: `nothing handles ${scheme}: in this session`,
        request,
        type: "protocol_response",
      });
    } else {
      await respond(send, request, scheme, () => handler(asRequest(incoming)));
    }
  };

  return { answer, forSession };
};

/** What `protocol.registerSchemesAsPrivileged` is given for each scheme. */
export type CustomScheme = {
  readonly scheme: string;
  readonly privileges?: Readonly<Record<string, boolean | undefined>>;
};

const asRequest = (incoming: IncomingRequest) =>
  new Request(incoming.url, {
    headers: incoming.headers,
    method: incoming.method,
    ...(incoming.body === undefined
      ? {}
      : { body: Buffer.from(incoming.body, "base64") }),
  });

const respond = async (
  send: (request: ProtocolRequest) => void,
  request: number,
  scheme: string,
  handle: () => Response | Promise<Response>,
) => {
  let response: Response;
  try {
    response = await handle();
  } catch (error) {
    send({ error: whyFailed(error), request, type: "protocol_response" });
    return;
  }
  if (response.type === "error") {
    send({
      error: `the ${scheme}: handler answered with a network error`,
      request,
      type: "protocol_response",
    });
  } else if (response.body === null) {
    send({
      body: "",
      headers: headerPairs(response.headers),
      request,
      status: response.status,
      type: "protocol_response",
    });
  } else {
    send({
      headers: headerPairs(response.headers),
      request,
      status: response.status,
      stream: true,
      type: "protocol_response",
    });
    try {
      for await (const piece of response.body) {
        send({
          data: Buffer.from(piece).toString("base64"),
          request,
          type: "protocol_data",
        });
      }
      send({ request, type: "protocol_end" });
    } catch (error) {
      send({ error: whyFailed(error), request, type: "protocol_end" });
    }
  }
};

/** A response's headers as pairs, each Set-Cookie its own. */
const headerPairs = (headers: Headers): [string, string][] => [
  ...[...headers.entries()].filter(([name]) => name !== "set-cookie"),
  ...headers
    .getSetCookie()
    .map((cookie): [string, string] => ["set-cookie", cookie]),
];

const whyFailed = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What an Electron 24-style protocol handler hands its callback. */
type LegacyAnswer =
  | string
  | Uint8Array
  | NodeJS.ReadableStream
  | {
      readonly error?: number;
      readonly path?: string;
      readonly data?: string | Uint8Array | NodeJS.ReadableStream;
      readonly url?: string;
      readonly method?: string;
      readonly mimeType?: string;
      readonly charset?: string;
      readonly statusCode?: number;
      readonly headers?: Record<string, string | string[]>;
    };

type LegacyKind = "buffer" | "file" | "http" | "stream" | "string";

/** Electron's `ProtocolRequest`, from the request `handle` gives. */
const legacyRequest = async (request: Request) => ({
  headers: Object.fromEntries(request.headers),
  method: request.method,
  referrer: request.headers.get("referer") ?? "",
  uploadData:
    request.body === null
      ? []
      : [{ bytes: Buffer.from(await request.arrayBuffer()), type: "rawData" }],
  url: request.url,
});

const isStream = (value: unknown): value is NodeJS.ReadableStream =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { pipe?: unknown }).pipe === "function";

/** Chromium's net errors a handler answers with, as HTTP statuses. */
const statusOfError = (error: number) =>
  error === -6 || error === -10 ? 404 : 500;

/** The `Response` a legacy handler's answer of `kind` stands for. */
export const legacyResponse = async (
  kind: LegacyKind,
  answer: LegacyAnswer,
): Promise<Response> => {
  const options =
    typeof answer === "string" ||
    answer instanceof Uint8Array ||
    isStream(answer)
      ? {}
      : answer;
  if (options.error !== undefined) {
    return new Response(null, { status: statusOfError(options.error) });
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    for (const each of [value].flat()) {
      headers.append(name, each);
    }
  }
  if (options.mimeType !== undefined) {
    headers.set(
      "content-type",
      options.charset === undefined
        ? options.mimeType
        : `${options.mimeType}; charset=${options.charset}`,
    );
  }
  const status = options.statusCode ?? 200;
  const data =
    typeof answer === "string" ||
    answer instanceof Uint8Array ||
    isStream(answer)
      ? answer
      : answer.data;
  if (kind === "file") {
    const path = typeof answer === "string" ? answer : options.path;
    if (path === undefined) {
      return new Response(null, { status: 404 });
    }
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return new Response(null, { status: 404 });
    }
    if (!headers.has("content-type") && file.type !== "") {
      headers.set("content-type", file.type);
    }
    return new Response(file, { headers, status });
  } else if (kind === "http") {
    if (options.url === undefined) {
      return new Response(null, { status: 500 });
    }
    return fetch(options.url, { method: options.method ?? "GET" });
  } else if (isStream(data)) {
    const { Readable } = await import("node:stream");
    return new Response(
      Readable.toWeb(data as import("node:stream").Readable) as ReadableStream,
      { headers, status },
    );
  } else {
    return new Response(data ?? null, { headers, status });
  }
};

/**
 * Electron's `register*Protocol`, `unregisterProtocol` and
 * `isProtocolRegistered`, which apps written before `protocol.handle` call,
 * on top of `protocol`'s `handle`.
 */
export const withLegacyProtocols = <P extends Protocol>(protocol: P) => {
  const legacy = new Set<string>();
  const register =
    (kind: LegacyKind) =>
    (
      scheme: string,
      handler: (
        request: unknown,
        callback: (answer: LegacyAnswer) => void,
      ) => void,
    ) => {
      if (protocol.isProtocolHandled(scheme) && scheme !== "file") {
        return false;
      }
      protocol.handle(scheme, async (request) => {
        const asked = await legacyRequest(request);
        const answer = await new Promise<LegacyAnswer>((resolve) => {
          handler(asked, resolve);
        });
        return legacyResponse(kind, answer);
      });
      legacy.add(scheme);
      return true;
    };
  return Object.assign(protocol, {
    isProtocolRegistered: (scheme: string) => legacy.has(scheme),
    registerBufferProtocol: register("buffer"),
    registerFileProtocol: register("file"),
    registerHttpProtocol: register("http"),
    registerStreamProtocol: register("stream"),
    registerStringProtocol: register("string"),
    unregisterProtocol: (scheme: string) => {
      const had = legacy.delete(scheme);
      if (had) {
        protocol.unhandle(scheme);
      }
      return had;
    },
  });
};
