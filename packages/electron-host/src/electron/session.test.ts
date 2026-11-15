import { describe, expect, it } from "bun:test";

import type { PermissionMessage } from "./permissions";
import { createPermissions } from "./permissions";
import type { ProtocolRequest } from "./protocol";
import { createProtocols } from "./protocol";
import { createSessions, sessionPartition } from "./session";
import type { SessionCallMessage } from "./session-calls";
import { createSessionCalls } from "./session-calls";
import type { WebRequestMessage } from "./web-request";
import { createWebRequests } from "./web-request";

const setUp = () => {
  const sent: (
    | ProtocolRequest
    | WebRequestMessage
    | SessionCallMessage
    | PermissionMessage
  )[] = [];
  const calls = createSessionCalls((m) => sent.push(m));
  const sessions = createSessions(
    createProtocols((r) => sent.push(r)),
    createWebRequests(
      (m) => sent.push(m),
      () => undefined,
    ),
    calls,
    createPermissions(
      (m) => sent.push(m),
      () => undefined,
      () => undefined,
    ),
  );
  return { calls, sent, sessions };
};

describe(createSessions, () => {
  it("makes each partition's session once, the app's own for ''", () => {
    const { sessions } = setUp();

    expect(sessions.fromPartition("persist:a")).toBe(
      sessions.fromPartition("persist:a"),
    );
    expect(sessions.fromPartition("")).toBe(sessions.defaultSession);
    expect(sessions.fromPartition("a")).not.toBe(
      sessions.fromPartition("persist:a"),
    );
  });

  it("takes a display media handler, leaving the desktop's picker to answer", () => {
    const { sent, sessions } = setUp();
    let asked = false;

    sessions.defaultSession.setDisplayMediaRequestHandler(
      () => {
        asked = true;
      },
      { useSystemPicker: true },
    );

    expect(asked).toBe(false);
    expect(sent).toEqual([
      { scheme: "file", session: "", type: "handle_protocol" },
    ]);
  });

  it("names its partition for the engine", () => {
    const { sessions } = setUp();

    expect(sessionPartition(sessions.defaultSession)).toBe("");
    expect(sessionPartition(sessions.fromPartition("persist:a"))).toBe(
      "persist:a",
    );
  });

  it("gives each session its own protocol, serving file: from the start", () => {
    const { sent, sessions } = setUp();

    sessions
      .fromPartition("persist:a")
      .protocol.handle("app", () => new Response(""));

    expect(sessions.defaultSession.protocol.isProtocolHandled("app")).toBe(
      false,
    );
    expect(sent).toEqual([
      { scheme: "file", session: "", type: "handle_protocol" },
      { scheme: "file", session: "persist:a", type: "handle_protocol" },
      { scheme: "app", session: "persist:a", type: "handle_protocol" },
    ]);
  });

  it("gives each session its own webRequest", () => {
    const { sent, sessions } = setUp();
    const { webRequest } = sessions.fromPartition("persist:a");
    sent.length = 0;

    webRequest.onCompleted(() => undefined);

    expect(sent).toEqual([
      {
        events: ["completed"],
        session: "persist:a",
        type: "web_request_listen",
      },
    ]);
  });

  it("gives each session a permission request handler of its own", () => {
    const { sent, sessions } = setUp();
    const session = sessions.fromPartition("persist:a");
    sent.length = 0;

    session.setPermissionRequestHandler(() => undefined);

    expect(sent).toEqual([
      { handle: true, session: "persist:a", type: "permission_handler" },
    ]);
  });

  it("gives each session cookies and storage calls of its own partition", async () => {
    const { calls, sent, sessions } = setUp();
    sent.length = 0;

    const cleared = sessions.fromPartition("persist:a").clearCache();
    sessions.defaultSession.setUserAgent("Claude/1");
    const cookies = sessions.defaultSession.cookies.get({});
    calls.hear({ call: 1, result: null, type: "session_result" });
    calls.hear({ call: 3, result: [], type: "session_result" });

    // Less the file: handler each new session starts with.
    expect(sent.filter((m) => m.type === "session_call")).toEqual([
      {
        call: 1,
        method: "clear_cache",
        session: "persist:a",
        type: "session_call",
      },
      {
        call: 2,
        method: "set_user_agent",
        session: "",
        type: "session_call",
        user_agent: "Claude/1",
      },
      {
        call: 3,
        filter: {},
        method: "cookies_get",
        session: "",
        type: "session_call",
      },
    ]);
    expect(sessions.defaultSession.getUserAgent()).toBe("Claude/1");
    expect(await cleared).toBeUndefined();
    expect(await cookies).toEqual([]);
  });
});
