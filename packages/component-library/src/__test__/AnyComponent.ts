import type { ComponentType } from "react";

/**
 * A loosely-typed component bag used by storybook + test helpers that need
 * to render Input or Textarea (or any control with a discriminated-union
 * props type) without per-variant narrowing. The factories that consume this
 * type pass concrete prop shapes that both controls accept at runtime; the
 * discriminated union can't be satisfied structurally without spelling out
 * every variant.
 */
export type AnyComponent = ComponentType<Record<string, unknown>>;
