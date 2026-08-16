# Files & directories

How code is organized across files and directories, and where functions
should live within a file.

## File organization (top-to-bottom)

Source files read **top-to-bottom**. Entry points are at the top; utility
functions and helpers come *after* the call sites that reference them. A
reader should be able to start at line 1, hit the exported declaration in
the first screen-or-two, and find every helper it depends on by scrolling
down — never up.

The typical order is:

1. **Imports**, grouped by third-party first, then local. Within each
   group, sort alphabetically (the formatter handles this).
2. **Re-exports** that the module is just forwarding (`export { Foo } from
   "..."`). They belong with imports conceptually but go after them so the
   reader knows what's coming in versus going out.
3. **Module-level constants** that are simple values the exported entry
   point references — enums, lookup tables, fixed configuration. These are
   declared once and read many times.
4. **Type declarations** for the exported entry point's surface (props,
   parameter types, return shapes).
5. **The exported entry point** itself — the function / component / class
   the rest of the file exists to define.
6. **Helpers** the entry point calls. These come last because the reader
   already understands what they're in service of by the time they reach
   them.

`const`-declared values are not hoisted, but anything called only at
runtime (inside a function body, hook callback, JSX render, etc.) is fine
to define later in the file because by the time it runs, all module-level
declarations have evaluated. Don't pre-order utilities above their
consumer just because the linter would tolerate either — keep reading
flow top-to-bottom.

The one exception is values consumed at **module-load time** (e.g. an
object passed into a top-level `cva()` call). Because the consumer
evaluates immediately when the module loads, any helper it references
must already be defined. Put those helpers directly above the consumer;
runtime-only helpers still go at the file foot.

When a file's purpose introduces additional kinds of top-level
declarations (stylesheet recipes, schema definitions, fixtures), slot
them into the order where they make sense — typically alongside helpers,
since they're in service of the entry point. Package-specific docs may
pin a precise position; see
`packages/component-library/docs/STRUCTURE.md` for the canonical
component ordering.

## Import from defining modules

Import from the module that defines a symbol, not from a barrel
(`index.ts`) that re-exports it. Barrel imports pull in more than you
need, hide where things are defined, and cause bundle bloat and slow
builds.

Also avoid long re-export chains. If module `a` only needs something
from module `d`, import from `d` directly — not through `b` and `c`.

```ts
// wrong — barrel import
import { BridgeClient } from "@domicile/chrome-sdk";

// wrong — unnecessary chain (a → b → c → d)
import { BridgeClient } from "../chrome/helpers";

// correct — direct import from the defining module
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
```

## Avoid grab-bag files and directories

Every file and directory should have a single, clearly nameable purpose.
Avoid names like `utils`, `helpers`, `common`, `types`, `lib`, or
`shared` — these are catch-all buckets that grow into unmaintainable
junk drawers as unrelated code accumulates in them. When someone looks
at the directory tree, they should be able to predict roughly what's in
each file from its name.

Prefer many small files with focused names over a single grab-bag.
`src/Avatar/initials.ts` and `src/Avatar/gradient.ts` are better than
`src/Avatar/utils.ts` even if each contains only a handful of lines. A
`useControlValue.ts` hook file is better than dumping the hook into a
generic `hooks.ts`. A `slugify.ts` is better than a `string-helpers.ts`
that contains five unrelated string operations.

If you find yourself wanting to name a file `utils.ts`, that's a signal
to either (1) inline the code into its single consumer, or (2) split it
into multiple focused files.

The same applies to directories: `src/_control/` (a clearly-named
internal module for shared form-control machinery) is fine;
`src/common/` is not.

## Prefer module-scoped functions

Avoid defining functions inside closures when they can be hoisted to
module scope. Closure-scoped functions are re-created on every
invocation of the enclosing function, and they obscure the dependency
graph by implicitly capturing variables from the surrounding scope.
Prefer passing values as explicit parameters instead.

This does not apply to React hooks (e.g. functions passed to
`useCallback`) or cases where the function genuinely needs to close
over mutable local state that cannot be passed as a parameter.
