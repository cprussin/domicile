import { expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// `register()` has to run before `@testing-library/jest-dom` loads, because it
// accesses DOM globals when its module evaluates. Static imports are hoisted
// above this call, so it is deferred to a dynamic import.
GlobalRegistrator.register();

const { default: _, ...matchers } = await import(
  "@testing-library/jest-dom/matchers"
);

expect.extend(matchers);
