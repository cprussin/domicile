# Functions

Rules for declaring, documenting, and iterating in functions. See also
[/docs/guidelines/CONTROL_FLOW.md](/docs/guidelines/CONTROL_FLOW.md) for control-flow rules.

## Functional, immutable, declarative

Default to functional over procedural, immutable over mutable, and
declarative over imperative. Express results as `map`/`filter`/`reduce` and
other pipelines instead of loops that accumulate state; prefer `const`,
spreads, and `readonly` over reassignment and in-place mutation; describe
*what* the result is, not the step-by-step *how*.

```ts
// wrong
const doubled: number[] = [];
for (const x of values) {
  doubled.push(x * 2);
}

// correct
const doubled = values.map((x) => x * 2);
```

Reach for procedural or mutable code only when it is genuinely clearer or
when interop with a mutating API requires it.

## Prefer arrow function syntax

Define functions with arrow syntax assigned to a `const`, not with the
`function` keyword. Arrow declarations are consistent with how every other
value is bound (`const x = ...`), they don't hoist (which makes evaluation
order explicit in the source), and they don't introduce a `this` binding.

For example, instead of:

```ts
function getInitials(name: string): string {
  return name[0]?.toUpperCase() ?? "?";
}
```

Prefer:

```ts
const getInitials = (name: string): string =>
  name[0]?.toUpperCase() ?? "?";
```

The only exceptions are cases where hoisting is genuinely required (e.g.
a helper that's called by a module-level `const` defined above it, where
moving the helper above the consumer would itself violate top-to-bottom
reading order — see `packages/component-library/docs/STRUCTURE.md` for
the canonical case).

## Docstrings

Use JSDoc (`/** ... */`) only when the code is complex enough that names
and types alone aren't enough. Don't restate what the signature already
says — skip trivial docstrings.

Format: short summary; add `@param` / `@returns` only when types
aren't self-explanatory.

```ts
// wrong — restates the obvious
/** Returns the user's initials. */
const getInitials = (name: string): string => ...

// good — explains non-obvious behavior and parameter shapes
/**
 * Converts unified messages into provider chat params. System messages are
 * stripped from the array and returned separately — the API takes `system`
 * as a top-level field, not a message role.
 *
 * @param messages - Full conversation history including system, user,
 *   assistant, and tool roles.
 * @returns `system` text (concatenated when multiple system messages exist)
 *   and `messages` with consecutive tool results folded into one user turn.
 */
const toProviderMessages = (
  messages: readonly Message[],
): {
  system: string | undefined;
  messages: ProviderMessage[];
} => ...
```

## Prefer manual loops to generators

The default for transforming a collection is a declarative pipeline (see
[Functional, immutable, declarative](#functional-immutable-declarative)):
`messages.filter((m) => m.content.length > 0).map(toApiMessage)`. When a
plain loop *is* the right tool — the procedural form is genuinely clearer, or
you must mutate as you go — prefer a `for` loop over a `function*` generator.
Loops keep state and control flow in one place and are easier to scan. The
exceptions where a generator is warranted are when you genuinely need lazy
streaming, or when consuming generator output from an external package.

```ts
// prefer — a plain loop when imperative iteration is warranted
const toApiMessages = (messages: Message[]): ApiMessage[] => {
  const result: ApiMessage[] = [];
  for (const m of messages) {
    if (m.content.length === 0) {
      continue;
    }
    result.push({ content: m.content, role: m.role });
  }
  return result;
};

// over — a generator for the same work
const toApiMessages = function* (messages: Message[]): Iterable<ApiMessage> {
  for (const m of messages) {
    if (m.content.length === 0) {
      continue;
    }
    yield { content: m.content, role: m.role };
  }
};
```
