import { describe, expect, it } from "bun:test";
import type { LogSink } from "./logger";
import { logger } from "./logger";

const recording = () => {
  const said: [string, unknown[]][] = [];
  const sink: LogSink = {
    debug: (...line: unknown[]) => said.push(["debug", line]),
    error: (...line: unknown[]) => said.push(["error", line]),
    info: (...line: unknown[]) => said.push(["info", line]),
    warn: (...line: unknown[]) => said.push(["warn", line]),
  };
  return { said, sink };
};

describe("logger", () => {
  it("starts each line with its subsystem, at the level asked", () => {
    const { said, sink } = recording();
    const log = logger("notifications", sink);
    log.error("lost", 3);
    log.warn("odd");
    log.info("shown");
    log.debug("detail");
    expect(said).toEqual([
      ["error", ["[notifications]", "lost", 3]],
      ["warn", ["[notifications]", "odd"]],
      ["info", ["[notifications]", "shown"]],
      ["debug", ["[notifications]", "detail"]],
    ]);
  });

  it("writes an object as its JSON and an error as its stack, as the engine logs only text", () => {
    const { said, sink } = recording();
    const error = new Error("gone");
    logger("network", sink).warn("refused", { kind: "Busy" }, error, 3);
    expect(said).toEqual([
      ["warn", ["[network]", "refused", '{"kind":"Busy"}', error.stack, 3]],
    ]);
  });

  it("refuses a subsystem the journal could not file", () => {
    expect(() => logger("two words")).toThrow(/letters, digits/);
    expect(() => logger("")).toThrow(/letters, digits/);
  });
});
