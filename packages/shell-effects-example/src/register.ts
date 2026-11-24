// Registers the reference effects with the engine, by the names their
// `domicile-shader()` functions use.

import { Result } from "@cprussin/option-result";
import type {
  Effects,
  RegisteredEffect,
  ShaderEffect,
} from "@domicile-desktop/sdk/desktop/effects";

import { CLOTH, cloth } from "./cloth";
import { CUBE_FACE, cubeFace } from "./cube";
import { LIQUID_GLASS, liquidGlass } from "./liquid-glass";
import { SMOKE, smoke } from "./smoke";
import { SWARM, swarm } from "./swarm";

/** The registered effects, by name. */
export type Registered = ReadonlyMap<string, RegisteredEffect>;

/**
 * Registers every effect, the smoke sampling the noise image at `noise`.
 * Fails with the first effect the engine refused, and why.
 */
export const registerEffects = async (
  effects: Pick<Effects, "register">,
  noise: string,
): Promise<Result<Registered, string>> => {
  const all: [string, ShaderEffect][] = [
    [SMOKE, smoke(noise)],
    [CLOTH, cloth],
    [SWARM, swarm],
    [LIQUID_GLASS, liquidGlass],
    [CUBE_FACE, cubeFace],
  ];
  const results = await Promise.all(
    all.map(async ([name, effect]) =>
      (await effects.register(name, effect))
        .map((registered): [string, RegisteredEffect] => [name, registered])
        .mapErr((why) => `${name}: ${why}`),
    ),
  );
  return Result.collect(results).map((registered) => new Map(registered));
};
