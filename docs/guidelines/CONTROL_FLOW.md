# Control flow

Rules for values, branches, and bindings inside functions. See also
[/docs/guidelines/FUNCTIONS.md](/docs/guidelines/FUNCTIONS.md) for function declaration,
documentation, and iteration rules.

## Null vs undefined

Always use `undefined` instead of `null` wherever possible. Avoid
introducing `null` into new code — use `undefined` for optional values,
missing data, and uninitialized state. The only acceptable use of `null`
is when required by an external API or library that explicitly expects it.

## Explicit undefined checks

Always check for `undefined` explicitly rather than relying on truthiness.
Use `=== undefined` or `!== undefined` instead of `!foo` or `!!foo` when
checking whether a value is defined.

For example, instead of:

```ts
if (!value) {
  handleMissing();
}
```

Prefer:

```ts
if (value === undefined) {
  handleMissing();
}
```

This avoids accidentally treating `0`, `""`, or `false` as missing values.

## Curly braces always

Always use curly braces for `if`/`for`/`while` bodies, even single-line ones.

```ts
// wrong
if (value === undefined) handleMissing();

// correct
if (value === undefined) {
  handleMissing();
}
```

## Explicit control flow

All branches must be visible in the control structure. Avoid early returns,
guard clauses, and other constructs that exit a function without the control
flow being represented structurally.

For example, instead of:

```ts
const doSomething = (value: string | undefined) => {
  if (value === undefined) {
    throw new Error("value is required");
  }
  return process(value);
};
```

Prefer:

```ts
const doSomething = (value: string | undefined) => {
  if (value === undefined) {
    throw new Error("value is required");
  } else {
    return process(value);
  }
};
```

**Exception: no-op arms.** When one arm of the conditional would be empty
(just `return;`, a no-op comment, or nothing at all), use the negated
condition with a single-arm `if` instead. Don't write an empty `else` block,
and don't pair a bare `return;` against an `else` whose body is the entire
remaining logic — those forms exist only because the rule above pushed both
branches into the structure, and once one of them has no work the structure
no longer earns its keep.

```ts
// wrong — empty positive arm
if (preview === undefined) {
  // nothing to do
} else {
  applyPreview(preview);
}

// wrong — bare return paired with the else
if (canceled) {
  return;
} else {
  setState(next);
}

// correct
if (preview !== undefined) {
  applyPreview(preview);
}

if (!canceled) {
  setState(next);
}
```

## Prefer ternaries

When an `if`/`else` block assigns or returns a value in both branches,
prefer a ternary expression. This keeps the code concise and makes it
clear that the result is a single value derived from a condition.

For example, instead of:

```ts
let result: string;
if (condition) {
  result = "yes";
} else {
  result = "no";
}
```

Prefer:

```ts
const result = condition ? "yes" : "no";
```

Similarly for returns:

```ts
// instead of:
if (condition) {
  return foo;
} else {
  return bar;
}

// prefer:
return condition ? foo : bar;
```

Do not use ternaries when the expressions are complex or multi-line — only
use them when both branches are simple, single expressions. Never nest
ternaries.

## Avoid unnecessary `let`

Avoid `let` bindings that exist only to be assigned inside control flow.
Instead, extract the computation into a separate function that returns
the value, allowing you to use `const`.

For example, instead of:

```ts
let foo: string;
if (bar) {
  foo = "bar";
} else if (baz) {
  foo = "baz";
} else {
  foo = "bing";
}
```

Prefer:

```ts
const getFoo = () => {
  if (bar) {
    return "bar";
  } else if (baz) {
    return "baz";
  } else {
    return "bing";
  }
};
const foo = getFoo();
```

For simple cases, a ternary may suffice instead of a helper function.

## Prefer `switch` over `if`/`else if` chains

When branching on a single value across multiple cases, use a `switch`
statement instead of an `if`/`else if` chain.

When the switched value is an enumerated type (union, enum, etc.), do NOT
include a `default` arm. Omitting `default` allows TypeScript's
exhaustiveness checking to report a compile error if a new variant is
added to the type but not handled in the switch.

For example, instead of:

```ts
if (status === "loading") {
  return renderLoading();
} else if (status === "loaded") {
  return renderLoaded();
} else {
  return renderError();
}
```

Prefer:

```ts
switch (status) {
  case "loading":
    return renderLoading();
  case "loaded":
    return renderLoaded();
  case "error":
    return renderError();
}
```

When the switched value is a discriminated union built with the enum +
constructor pattern, switch on the enum discriminant — see
[DISCRIMINATED_UNIONS.md](./DISCRIMINATED_UNIONS.md).
