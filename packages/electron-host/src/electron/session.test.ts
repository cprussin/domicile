import { describe, expect, it } from "bun:test";

import type { ProtocolRequest } from "./protocol";
import { createProtocols } from "./protocol";
import { createSessions, sessionPartition } from "./session";
import type { WebRequestMessage } from "./web-request";
import { createWebRequests } from "./web-request";

const setUp = () => {
  const sent: (ProtocolRequest | WebRequestMessage)[] = [];
  const sessions = createSessions(
    createProtocols((r) => sent.push(r)),
    createWebRequests(
      (m) => sent.push(m),
      () => undefined,
    ),
  );
  return { sent, sessions };
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
});
