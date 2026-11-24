// The shell's shader effects: SkSL that the GPU process runs over an element
// as `filter: domicile-shader(name, …)` or `backdrop-filter`. See
// docs/architecture/MOTION.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** A shader effect's program, and how far it draws outside its element. */
export type ShaderEffect = {
  /**
   * Strict ES2 SkSL of at most 32 KiB. Its child is `uniform shader
   * content`, the element as drawn, and its first uniform is
   * `uniform float2 size`, the element's size. `main`'s `p` runs from the
   * element's top left. Both are in device pixels, so pass
   * `devicePixelRatio` as a number to measure in CSS pixels. The uniforms
   * after `size` are the numbers `domicile-shader()` passes, in order, at
   * most 16 floats in all.
   */
  readonly sksl: string;
  /** How many CSS pixels it may draw outside the element. 0 by default. */
  readonly outset?: number;
};

export type EffectsListeners = {
  /**
   * The engine dropped effect `name`: the GPU process went while drawing
   * it, which a hung effect does. Its filters draw nothing until it is
   * registered again.
   */
  lost: (name: string) => void;
};

export type Effects = {
  /**
   * Compiles `effect` as `name`, which `domicile-shader(name, …)` then
   * draws: how many numbers it takes, or the compiler's error. A second
   * register of `name` replaces the first. Throws for an empty name or an
   * outset that is negative or not finite.
   */
  register: (
    name: string,
    effect: ShaderEffect,
  ) => Promise<Result<number, string>>;
  on: On<EffectsListeners>;
};

export type EffectsHost = Pick<
  DomicileHost,
  "addEventListener" | "registerShaderEffect" | "removeEventListener"
>;

export const effects = (host: EffectsHost): Effects => ({
  on: on<EffectsListeners>({
    lost: (listener) =>
      hostEvent(host, "shadereffectlost", (event) => listener(event.data)),
  }),
  register: (name, { sksl, outset = 0 }) =>
    host.registerShaderEffect(name, sksl, outset).then(
      (taken) => Ok<number, string>(taken),
      (error: unknown) =>
        Err<number, string>(
          error instanceof Error ? error.message : String(error),
        ),
    ),
});
