import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, None, Ok } from "@cprussin/option-result";
import type {
  Effects,
  RegisteredEffect,
  ShaderEffect,
} from "@domicile-desktop/sdk/desktop/effects";

import { cloth } from "./cloth";
import { cubeFace } from "./cube";
import { liquidGlass } from "./liquid-glass";
import { registerEffects } from "./register";
import { smoke } from "./smoke";
import { swarm } from "./swarm";

/** Effects that register everything but `refused`, recording each call. */
const recording = (refused?: string) => {
  const calls: [string, ShaderEffect][] = [];
  const effects: Pick<Effects, "register"> = {
    register: (name, effect) => {
      calls.push([name, effect]);
      return Promise.resolve(
        name === refused
          ? Err<RegisteredEffect, string>("error: 3: unknown identifier")
          : Ok<RegisteredEffect, string>({
              arguments: 1,
              update: () => None(),
            }),
      );
    },
  };
  return { calls, effects };
};

const names = (result: Result<ReadonlyMap<string, RegisteredEffect>, string>) =>
  result.map((registered) => [...registered.keys()]);

describe("registerEffects", () => {
  it("registers each reference effect by its name", async () => {
    const { calls, effects } = recording();

    const result = await registerEffects(effects, "blob:noise");

    expect(calls).toEqual([
      ["smoke", smoke("blob:noise")],
      ["cloth", cloth],
      ["swarm", swarm],
      ["liquid-glass", liquidGlass],
      ["cube-face", cubeFace],
    ]);
    expect(names(result)).toEqual(
      Ok(["smoke", "cloth", "swarm", "liquid-glass", "cube-face"]),
    );
  });

  it("names the effect the engine refused, and why", async () => {
    const { effects } = recording("swarm");

    expect(names(await registerEffects(effects, "blob:noise"))).toEqual(
      Err("swarm: error: 3: unknown identifier"),
    );
  });
});
