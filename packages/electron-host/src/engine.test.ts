import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Engine } from "./engine";
import { connectEngine, connectEngineWhenUp } from "./engine";
import type { FakeEngine } from "./engine-fixture";
import { startFakeEngine } from "./engine-fixture";

let fake: FakeEngine | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const connected = async (fakeEngine: FakeEngine) =>
  (
    await connectEngine(
      fakeEngine.path,
      "com.example.Notes",
      "persist:electron-notes",
    )
  ).match({
    Err: (why): Engine => {
      throw new Error(why);
    },
    Ok: (engine) => engine,
  });

describe(connectEngine, () => {
  it("says hello with the app's id and partition, and is ready once answered", async () => {
    fake = await startFakeEngine();

    await connected(fake);

    expect(fake.heard).toEqual([
      {
        app_id: "com.example.Notes",
        partition: "persist:electron-notes",
        type: "hello",
        version: 1,
      },
    ]);
  });

  it("names the browser profile its windows open in, when it has one", async () => {
    fake = await startFakeEngine();

    await connectEngine(fake.path, "a", "persist:a", "work");

    expect(fake.heard).toEqual([
      {
        app_id: "a",
        partition: "persist:a",
        profile: "work",
        type: "hello",
        version: 1,
      },
    ]);
  });

  it("knows the engine's user agent and Chrome version from its ready", async () => {
    fake = await startFakeEngine();

    const engine = await connected(fake);

    expect(engine.browser).toEqual({
      chromeVersion: "160.0.8155.0",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Safari/537.36",
    });
  });

  it("says why the engine refused the app", async () => {
    fake = await startFakeEngine(() => [
      { type: "refused", why: "this engine speaks version 2" },
    ]);

    expect(await connectEngine(fake.path, "a", "persist:a")).toEqual(
      Err("the engine refused this app: this engine speaks version 2"),
    );
  });

  it("says where it looked when there is no engine", async () => {
    const result = await connectEngine("/nonexistent/electron.sock", "a", "b");

    expect(
      result.match({ Err: (why) => why, Ok: () => "connected" }),
    ).toStartWith("can't reach the engine at /nonexistent/electron.sock");
  });

  it("passes on each window event", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const heard = new Promise((resolve) => engine.events.on("window", resolve));

    fake.say({ title: "Notes", type: "title_changed", window: 1 });

    expect(await heard).toEqual({
      title: "Notes",
      type: "title_changed",
      window: 1,
    });
  });

  it("passes on each protocol request", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const heard = new Promise((resolve) =>
      engine.events.on("protocol", resolve),
    );
    const request = {
      headers: [["accept", "*/*"]],
      method: "GET",
      request: 3,
      session: "",
      type: "protocol_request",
      url: "file:///a",
    };

    fake.say(request);

    expect(await heard).toEqual(request);
  });

  it("passes on each webRequest event", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const heard = new Promise((resolve) =>
      engine.events.on("webRequest", resolve),
    );
    const event = {
      ask: 2,
      event: "before_request",
      id: 7,
      method: "GET",
      referrer: "",
      resource_type: "mainFrame",
      session: "",
      type: "web_request",
      url: "https://a.test/",
      window: 1,
    };

    fake.say(event);

    expect(await heard).toEqual(event);
  });

  it("passes on each permission request", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const heard = new Promise((resolve) =>
      engine.events.on("permissionRequest", resolve),
    );
    const event = {
      ask: 3,
      media_types: ["video"],
      permission: "media",
      requesting_url: "https://a.test/",
      session: "",
      type: "permission_request",
      window: 1,
    };

    fake.say(event);

    expect(await heard).toEqual(event);
  });

  it("passes on each session result, with its result or its error", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const heard: unknown[] = [];
    const both = new Promise((resolve) =>
      engine.events.on("sessionResult", (result) => {
        heard.push(result);
        if (heard.length === 2) {
          resolve(heard);
        }
      }),
    );

    fake.say({ call: 1, result: null, type: "session_result" });
    fake.say({ call: 2, error: "no", type: "session_result" });

    expect(await both).toEqual([
      { call: 1, result: null, type: "session_result" },
      { call: 2, error: "no", type: "session_result" },
    ]);
  });

  it("says when the engine goes", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const lost = new Promise((resolve) => engine.events.on("lost", resolve));

    fake.drop();

    expect(await lost).toBe("the engine closed this app's connection");
  });
});

describe(connectEngineWhenUp, () => {
  const notUp: Result<Engine, string> = Err(
    "can't reach the engine at /run/electron.sock: connect ENOENT /run/electron.sock",
  );

  it("tries again until the desktop's engine is listening", async () => {
    const engine = { events: new EventEmitter() } as unknown as Engine;
    const answers: Result<Engine, string>[] = [notUp, notUp, Ok(engine)];
    let tries = 0;

    const result = await connectEngineWhenUp(
      () => Promise.resolve(answers[tries++] ?? notUp),
      10_000,
      () => Promise.resolve(),
    );

    expect(result).toEqual(Ok(engine));
    expect(tries).toBe(3);
  });

  it("says how long it waited for an engine that never came up", async () => {
    const result = await connectEngineWhenUp(
      () => Promise.resolve(notUp),
      0,
      () => Promise.resolve(),
    );

    expect(
      result.match({ Err: (why) => why, Ok: () => "connected" }),
    ).toContain("still wasn't up after 0s");
  });

  it("answers a refusal at once", async () => {
    let tries = 0;
    const refused: Result<Engine, string> = Err(
      "the engine refused this app: version 2",
    );

    expect(
      await connectEngineWhenUp(
        () => {
          tries += 1;
          return Promise.resolve(refused);
        },
        10_000,
        () => Promise.resolve(),
      ),
    ).toEqual(refused);
    expect(tries).toBe(1);
  });
});
