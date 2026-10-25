import { describe, expect, it } from "bun:test";
import { desktop } from "./desktop/desktop";
import { FakeDomicileHost } from "./fake-host";
import {
  defineOptions,
  option,
  optionsSchema,
  readOptions,
  watchShellOptions,
} from "./options";

const OPTIONS = defineOptions({
  clock: {
    format: option.choice("Clock format", ["24h", "12h"], "24h"),
    seconds: option.toggle("Show seconds", false),
  },
  gaps: option.number("Gap between windows", 8, { max: 64, min: 0 }),
  greeting: option.text("Greeting", "hello"),
  hidden: option.list("Hidden apps", ["a"]),
});

describe("defineOptions", () => {
  it("turns nested objects into groups, in a JSON form that parses back", () => {
    const json: unknown = JSON.parse(JSON.stringify(OPTIONS));
    expect(optionsSchema.parse(json)).toEqual(OPTIONS);
    expect(OPTIONS.clock).toEqual({
      kind: "group",
      options: {
        format: {
          choices: ["24h", "12h"],
          default: "24h",
          kind: "choice",
          label: "Clock format",
        },
        seconds: { default: false, kind: "toggle", label: "Show seconds" },
      },
    });
  });

  it("refuses a default its own limits or choices refuse", () => {
    expect(() =>
      defineOptions({ gaps: option.number("Gaps", 80, { max: 64 }) }),
    ).toThrow();
    expect(() =>
      defineOptions({ side: option.choice("Side", ["top"], "left" as "top") }),
    ).toThrow();
  });
});

describe("readOptions", () => {
  it("gives every option its default when the config sets none", () => {
    expect(readOptions(OPTIONS, undefined)).toEqual({
      dropped: [],
      values: {
        clock: { format: "24h", seconds: false },
        gaps: 8,
        greeting: "hello",
        hidden: ["a"],
      },
    });
  });

  it("takes the values the config sets, typed by the declaration", () => {
    const { values } = readOptions(OPTIONS, { clock: { format: "12h" } });
    const format: "24h" | "12h" = values.clock.format;
    const seconds: boolean = values.clock.seconds;
    expect({ format, seconds }).toEqual({ format: "12h", seconds: false });
    expect(
      readOptions(OPTIONS, {
        clock: { format: "12h" },
        gaps: 4,
        greeting: "hi",
        hidden: ["b", "c"],
      }).values,
    ).toEqual({
      clock: { format: "12h", seconds: false },
      gaps: 4,
      greeting: "hi",
      hidden: ["b", "c"],
    });
  });

  it("drops an unknown key or a bad value and says where", () => {
    const { dropped, values } = readOptions(OPTIONS, {
      clock: { format: "13h", seconds: "yes" },
      gaps: 65,
      hidden: [1],
      shape: "round",
    });
    expect(values).toEqual(readOptions(OPTIONS, undefined).values);
    expect(dropped).toEqual([
      'clock.format: "13h" is not one of 24h, 12h',
      'clock.seconds: "yes" is not true or false',
      "gaps: 65 is above 64",
      "hidden: [1] is not a list of text",
      "shape: no such option",
    ]);
  });

  it("drops a group that is not an object", () => {
    expect(readOptions(OPTIONS, { clock: 3 }).dropped).toEqual([
      "clock: 3 is not a group of options",
    ]);
    expect(readOptions(OPTIONS, { clock: null }).dropped).toEqual([
      "clock: null is not a group of options",
    ]);
  });
});

describe("watchShellOptions", () => {
  const CLOCK = defineOptions({
    format: option.choice("Clock format", ["24h", "12h"], "24h"),
  });

  it("gives the defaults until the compositor says", async () => {
    const fake = new FakeDomicileHost();
    expect(
      await new Promise<unknown>((resolve) => {
        watchShellOptions(desktop(fake.host), CLOCK, resolve);
      }),
    ).toEqual({ format: "24h" });
  });

  it("gives the values each change sets, and reports what it dropped", () => {
    const fake = new FakeDomicileHost();
    const heard: unknown[] = [];
    const reported: string[] = [];
    const stop = watchShellOptions(
      desktop(fake.host),
      CLOCK,
      (values) => heard.push(values),
      (dropped) => reported.push(dropped),
    );

    fake.set({ shellOptions: '{"format":"12h","shape":"round"}' });
    stop();
    fake.set({ shellOptions: '{"format":"24h"}' });

    expect(heard).toEqual([{ format: "24h" }, { format: "12h" }]);
    expect(reported).toEqual(["shape: no such option"]);
  });
});
