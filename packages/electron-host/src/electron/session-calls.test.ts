import { describe, expect, it } from "bun:test";

import type { SessionCallMessage } from "./session-calls";
import { createSessionCalls } from "./session-calls";

const setUp = () => {
  const sent: SessionCallMessage[] = [];
  const calls = createSessionCalls(
    (message) => sent.push(message),
    () => "Notes/1 Electron/45",
  );
  return { calls, sent };
};

describe(createSessionCalls, () => {
  it("asks the engine for a session's cookies in Electron's names", async () => {
    const { calls, sent } = setUp();
    const { cookies } = calls.forSession("persist:a");

    const got = cookies.get({ httpOnly: true, url: "https://a.test/" });
    calls.hear({
      call: 1,
      result: [{ domain: "a.test", name: "n", value: "v" }],
      type: "session_result",
    });

    expect(sent).toEqual([
      {
        call: 1,
        filter: { http_only: true, url: "https://a.test/" },
        method: "cookies_get",
        session: "persist:a",
        type: "session_call",
      },
    ]);
    expect(await got).toEqual([{ domain: "a.test", name: "n", value: "v" }]);
  });

  it("sets and removes cookies, and rejects with the engine's reason", async () => {
    const { calls, sent } = setUp();
    const { cookies } = calls.forSession("");

    const set = cookies.set({
      expirationDate: 5,
      httpOnly: true,
      name: "n",
      sameSite: "strict",
      url: "https://a.test/",
      value: "v",
    });
    const removed = cookies.remove("https://a.test/", "n");
    calls.hear({ call: 1, error: "no", type: "session_result" });
    calls.hear({ call: 2, result: null, type: "session_result" });

    expect(sent).toEqual([
      {
        call: 1,
        details: {
          expiration_date: 5,
          http_only: true,
          name: "n",
          same_site: "strict",
          url: "https://a.test/",
          value: "v",
        },
        method: "cookies_set",
        session: "",
        type: "session_call",
      },
      {
        call: 2,
        method: "cookies_remove",
        name: "n",
        session: "",
        type: "session_call",
        url: "https://a.test/",
      },
    ]);
    expect(set).rejects.toThrow("no");
    expect(await removed).toBeUndefined();
  });

  it("clears a session's storage and cache", async () => {
    const { calls, sent } = setUp();
    const session = calls.forSession("");

    const cleared = session.clearStorageData({
      origin: "https://a.test",
      storages: ["cookies", "localstorage"],
    });
    const everything = session.clearStorageData();
    const cache = session.clearCache();
    const flushed = session.cookies.flushStore();
    for (const call of [1, 2, 3, 4]) {
      calls.hear({ call, result: null, type: "session_result" });
    }

    expect(sent.map(({ call, ...rest }) => rest)).toEqual([
      {
        method: "clear_storage_data",
        origin: "https://a.test",
        session: "",
        storages: ["cookies", "localstorage"],
        type: "session_call",
      },
      { method: "clear_storage_data", session: "", type: "session_call" },
      { method: "clear_cache", session: "", type: "session_call" },
      { method: "cookies_flush", session: "", type: "session_call" },
    ]);
    expect(await Promise.all([cleared, everything, cache, flushed])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("gives a session the app's fallback user agent until it is set its own, and tells the engine", () => {
    const { calls, sent } = setUp();
    const session = calls.forSession("");

    expect(session.getUserAgent()).toBe("Notes/1 Electron/45");
    session.setUserAgent("Claude/1");

    expect(session.getUserAgent()).toBe("Claude/1");
    expect(sent).toEqual([
      {
        call: 1,
        method: "set_user_agent",
        session: "",
        type: "session_call",
        user_agent: "Claude/1",
      },
    ]);
  });

  it("fails loudly on a result nobody waits for", () => {
    const { calls } = setUp();

    expect(() =>
      calls.hear({ call: 9, result: null, type: "session_result" }),
    ).toThrow("the engine answered session call 9, which nothing waits for");
  });
});
