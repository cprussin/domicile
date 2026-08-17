import { afterEach, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// `register()` has to run before `@testing-library/jest-dom` and
// `@testing-library/react` load, because both access DOM globals when their
// modules evaluate. Static imports are hoisted above this call, so they are
// deferred to dynamic imports.
GlobalRegistrator.register();

const { default: _, ...matchers } = await import(
  "@testing-library/jest-dom/matchers"
);
const { cleanup } = await import("@testing-library/react");

expect.extend(matchers);

afterEach(cleanup);
