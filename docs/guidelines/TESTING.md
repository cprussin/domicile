# Testing

General testing rules for the TypeScript monorepo. Package-specific testing
docs (test runner library, what to cover for a given kind of unit) live in
the package's own `docs/` directory.

## STOP — TDD is mandatory for every change

All functionality MUST be thoroughly tested. Code without tests does not
ship. **Do not write any production code until a failing test exists.** This
is a hard rule, not a guideline you weigh against other concerns.

**The cycle, in order. No step may be skipped or merged:**

1. Write a failing test for the behavior you want.
2. Run it; confirm it fails *for the right reason* (asserting on the absent
   behavior, not on a typo or compile error).
3. Write the **minimum** production code to make that test pass — nothing
   more. No extra branches, fields, parameters, helpers, or "while I'm here"
   cleanup.
4. Run it; confirm it passes.
5. Refactor only while the test is green.
6. Repeat for the next slice of behavior.

**What this rule applies to:** every change. New modules, new functions, new
branches in existing code, bug fixes, refactors that change behavior, small
fixes, "one-line" fixes, "obvious" fixes, urgent fixes. Familiarity and size
are not exemptions.

**Bug fixes specifically:** reproduce the bug as a failing test *first*.
Watch it fail. Then fix. A PR that fixes a bug without a regression test is
incomplete.

**What this rule forbids:**

- Writing production code first and adding tests after.
- Writing the test and the code in the same edit, then claiming TDD.
- Skipping the run-and-watch-it-fail step.
- Adding code that no test exercises (speculative branches, unused
  parameters, defensive error handling for cases no test triggers — see
  [/docs/guidelines/ERRORS.md](/docs/guidelines/ERRORS.md)).
- Claiming a change is "too small" or "too obvious" to test.
- Loosening an assertion to make a test pass instead of fixing the code.

**The only exception** is code where a test would be prohibitively difficult
to write *and* would have very low value (e.g. trivial glue over a
third-party API surface with no logic of its own). Both halves must hold, and
you MUST justify both in the PR description. "It was faster" is not a
justification. If you reach for this exception more than rarely, the
production code probably needs restructuring for testability (see *Prefer
dependency injection over mocking* below) — that restructure is part of the
task.

**If you cannot figure out how to test a change, stop and ask.** Do not
proceed by writing untested code.

## Parsimonious coverage

Thorough does not mean redundant. Each test should add coverage that no
other test already provides — a distinct behavior, edge case, or failure
mode. Avoid overlapping tests that assert the same thing in slightly
different ways; a large suite of redundant tests is harder to maintain and
doesn't increase confidence.

Before adding a test, assess whether an existing test already covers the
behavior. If it does, extend that test or refactor the suite instead of
adding another.

## Unit tests over integration tests

Prefer unit tests. Reach for integration tests only when a behavior cannot
be exercised through unit tests alone — typically because it spans multiple
processes, real I/O, or infrastructure you cannot inject at the unit
boundary.

With clean API boundaries, unit tests should suffice for most logic. When
they don't, that's often a signal the boundaries aren't clean enough — the
code under test may be doing too much, or dependencies aren't injectable.
Fix the seam first; don't paper over it with a heavier integration test.

When integration tests are necessary, keep them in a dedicated folder
separate from unit tests (e.g. `src/__integration__/` or
`tests/integration/`). Don't mix them into the unit test tree.

## Selectors

Prefer semantic / accessibility-oriented selectors over fragile structural
ones. For DOM tests, that means `screen.getByRole("button", { name: "Save" })`
over `container.querySelector("button.save")`. Tests that rely on
implementation details break for unrelated reasons.

## Structure

Group related assertions with nested `describe` blocks when a unit has
multiple distinct concerns (rendering vs. interactions vs. imperative API,
etc.) so failures point clearly at the affected concern.

## Dependency injection over mocking

**Prefer dependency injection over mocking.** When a unit depends on an
external collaborator (a clock, a network client, a filesystem, a random
source), accept that collaborator as an argument or a constructor parameter
and pass a real test double from the test, rather than reaching into a
module registry to swap out an import. Injected code is easier to follow
(the dependency is visible in the signature), the test double can be a
plain object that satisfies a small interface (no module-mock magic), and
the same seam can be reused for production substitution later (different
clients per environment, etc.).

Mocking module imports (`mock.module(...)`, `jest.mock(...)`,
monkey-patched globals) couples the test to the import graph, hides which
collaborator is being substituted, and tends to leak state between tests.
Reach for it only when injection is genuinely impossible — usually because
the dependency is a platform global you don't own. If you find yourself
mocking your own code, that's a signal the code under test should take the
collaborator as a parameter instead.

### Default injection parameters to the real implementation

Every injection parameter that exists *for testability* must default to the
real implementation. Consumers call the function with no arguments; tests
pass an override.

```ts
import { connectWebSocket as defaultConnect } from "./websocket-bun-client";

export const openConnection = (
  url: string,
  connect: typeof defaultConnect = defaultConnect,
): Promise<WireConnection> => connect(url);
```

Type the parameter as `typeof <defaultImpl>` so the stub's surface stays
locked to the real one. The injection point exists to make the unit testable;
it is not a public configuration knob. Forcing every consumer to pass the
dependency leaks a testing concern into the API and adds a useless import at
every call site.

## Test callbacks by promisifying, not mocking

When the assertion is "this callback fires (with these arguments)," promisify
the callback and `await` it inside an `async` test instead of passing a mock
function and inspecting its call records.

```ts
describe("theThing", () => {
  it("does the thing", async () => {
    const calledArgs = await new Promise((resolve) => {
      theThing(resolve);
    });
    expect(calledArgs); /* ... */
  });
});
```

The promise pattern asserts "the callback fired" implicitly — the test would
time out otherwise — and yields the arguments directly, so the assertion is
on real values instead of `mock.calls[0][0]`. Reach for a mock function only
when the promise pattern cannot express what you need to verify (e.g. call
count, ordering across multiple callbacks).

## Never widen exports for tests

A module's exports are its public API. Never add an export solely because a
test needs it.

If a test needs internal functionality, or would be significantly cleaner
with access to it, split those internals into their own module and test that
module through its real public API. This keeps every export justified by a
real caller.

## Warnings are failures

Any warning surfaced by the test suite is a failure. Treat it like a non-zero
exit code: a PR with new warnings is not ready to merge, and a PR that lands
on top of existing warnings must clear them. This covers biome warnings
(including unused or misplaced `// biome-ignore` suppressions), React's
"not wrapped in act(...)" warning, and any other diagnostic a runner emits
alongside the green summary (`console.error`, deprecation notices, etc.).

Fix the cause; don't suppress a warning to make the suite "clean," and don't
add filters. If the cause is genuinely in a dependency you can't reach,
escalate rather than silence it.

## Package-specific guidance

Library choice and what to cover for a given kind of unit (component test
patterns, etc.) belong in package-specific docs.
