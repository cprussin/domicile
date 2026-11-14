import { afterEach, describe, expect, it } from "bun:test";
import { Err } from "@cprussin/option-result";
import type { Engine } from "./engine";
import { connectEngine } from "./engine";
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

  it("says when the engine goes", async () => {
    fake = await startFakeEngine();
    const engine = await connected(fake);
    const lost = new Promise((resolve) => engine.events.on("lost", resolve));

    fake.drop();

    expect(await lost).toBe("the engine closed this app's connection");
  });
});
