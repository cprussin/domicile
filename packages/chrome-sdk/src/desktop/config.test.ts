import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { switchInConfig } from "./config";
import { desktop } from "./desktop";

const answer = (overrides: object[], refused?: string) =>
  JSON.stringify({
    overrides,
    type: "config_overrides",
    ...(refused === undefined ? {} : { refused }),
  });

const DARK = { path: ["theme", "mode"], value: '"dark"', written: '"light"' };

describe("config", () => {
  it("sends each change and matches each answer to it in order", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const set = config.setOverride(["theme", "mode"], "dark");
    const listed = config.overrides();
    const reset = config.resetOverrides([["theme"]]);

    expect(fake.calls).toStrictEqual([
      [
        "changeConfig",
        '{"path":["theme","mode"],"type":"set_config_override","value":"\\"dark\\""}',
      ],
      ["changeConfig", '{"type":"which_config_overrides"}'],
      ["changeConfig", '{"paths":[["theme"]],"type":"reset_config_overrides"}'],
    ]);
    fake.dispatch("configoverrides", { data: answer([DARK]) });
    fake.dispatch("configoverrides", { data: answer([DARK]) });
    fake.dispatch("configoverrides", { data: answer([]) });
    const changed = [
      { path: ["theme", "mode"], value: "dark", written: "light" },
    ];
    expect(await set).toStrictEqual(changed);
    expect(await listed).toStrictEqual(changed);
    expect(await reset).toStrictEqual([]);
  });

  it("sends null for a setting's default", () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const set = config.setOverride(["theme", "mode"], undefined);

    expect(fake.calls).toStrictEqual([
      [
        "changeConfig",
        '{"path":["theme","mode"],"type":"set_config_override","value":"null"}',
      ],
    ]);
    fake.dispatch("configoverrides", { data: answer([]) });
    return expect(set).resolves.toStrictEqual([]);
  });

  it("refuses a path with no list index, sending nothing", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    await expect(config.setOverride(["output", -1], 2)).rejects.toThrow(
      "-1 is no list index",
    );
    await expect(config.resetOverrides([["output", 2 ** 31]])).rejects.toThrow(
      "2147483648 is no list index",
    );
    expect(fake.calls).toStrictEqual([]);
  });

  it("refuses a value JSON has no text for, sending nothing", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    await expect(
      config.setOverride(["theme", "mode"], () => "dark"),
    ).rejects.toThrow("has no JSON");
    expect(fake.calls).toStrictEqual([]);
  });

  it("rejects the request an unreadable answer answers, and keeps step", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const first = config.overrides();
    const second = config.overrides();
    // The listener's throw goes to the event target's error report.
    fake.dispatch("configoverrides", { data: "{not json" });
    fake.dispatch("configoverrides", { data: answer([]) });
    await expect(first).rejects.toThrow("unreadable");
    expect(await second).toStrictEqual([]);
  });

  it("rejects with why the compositor refused a change", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const set = config.setOverride(["theme", "mode"], "purple");
    fake.dispatch("configoverrides", {
      data: answer([], "the config would refuse it"),
    });

    await expect(set).rejects.toThrow("the config would refuse it");
  });

  it("keeps a change made as the compositor restarts in step", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const before = config.overrides();
    const after = config.overrides();
    // The engine refuses what the old compositor never answered.
    fake.dispatch("configoverrides", {
      data: answer([], "the compositor exited before it answered"),
    });
    fake.dispatch("compositorreplaced");
    fake.dispatch("configoverrides", { data: answer([DARK]) });

    await expect(before).rejects.toThrow(
      "the compositor exited before it answered",
    );
    expect(await after).toHaveLength(1);
  });

  it("switches in the config one after another, so two quick switches both stay", async () => {
    const fake = new FakeDomicileHost();
    const { config } = desktop(fake.host);
    const path = ["browser", "profiles", "work", "extensions"];
    const work = {
      enabledExtensions: [],
      id: "work",
      lockedExtensions: ["a", "b"],
    };
    const settle = () => new Promise((done) => setTimeout(done, 0));
    const listed = (value: string[]) =>
      answer([
        { path, value: JSON.stringify(value), written: JSON.stringify([]) },
      ]);
    const first = switchInConfig(config, work, "a", true);
    const second = switchInConfig(config, work, "b", true);
    await settle();
    expect(fake.calls).toHaveLength(1);
    fake.dispatch("configoverrides", { data: answer([]) });
    await settle();
    fake.dispatch("configoverrides", { data: listed(["a"]) });
    await first;
    await settle();
    fake.dispatch("configoverrides", { data: listed(["a"]) });
    await settle();
    fake.dispatch("configoverrides", { data: listed(["a", "b"]) });
    await second;
    expect(JSON.parse(String(fake.calls.at(-1)?.[1]))).toStrictEqual({
      path,
      type: "set_config_override",
      value: JSON.stringify(["a", "b"]),
    });
  });
});
