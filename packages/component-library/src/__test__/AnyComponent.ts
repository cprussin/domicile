import type { ComponentType } from "react";

/**
 * A loosely typed component for story and test helpers that render controls
 * with discriminated-union props, such as Input and Textarea, without
 * narrowing each variant.
 */
export type AnyComponent = ComponentType<Record<string, unknown>>;
