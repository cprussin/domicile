# External data

Rules for handling data that crosses a runtime boundary — API responses,
WebSocket messages, `JSON.parse`, `localStorage`, the URL, etc.

## Prefer parsing to validating

Parse at the boundary and work with the returned typed value. Validating
without parsing — checking that data is well-formed but continuing to
treat it as untyped — breaks the type chain as soon as you leave the
check. Parsing keeps runtime checks and static types aligned through the
rest of the code.

## Parse external data with Zod

Never use `as` type casts when loading data from external sources.
External data is untyped at runtime and type-casting it bypasses all
safety. Instead, define a Zod schema for the expected shape and parse at
the boundary with `.parse()` (throws) or `.safeParse()` (returns a
result).

```ts
// wrong — trusts unparsed data
const data = (await response.json()) as { items: Item[] };

// correct — parses at the boundary
import { z } from "zod";

const responseSchema = z.object({ items: z.array(itemSchema) });
const data = responseSchema.parse(await response.json());
```

Derive the TypeScript type from the schema with `z.infer<typeof schema>`
so the type and the runtime check stay in sync automatically.

Use `.safeParse()` when invalid input should be handled, not thrown. Once
parsed at the boundary, internal callers trust the type — re-validating
internally is forbidden (see [code offensively](/docs/guidelines/ERRORS.md) in
ERRORS.md: validate at boundaries, trust internally).

## Version contracts that cross deploy units

Parsing handles a contract's current shape; versioning handles its
evolution. A contract needs a version when producer and consumer can be
on different releases at the same time — i.e. a breaking change could
strand an old consumer talking to a new producer.

**How to version**

- **HTTP / WebSocket endpoints** — put the version in the URL path:
  `wss://host/v1/agent`. Reject other paths at the boundary (404) so a
  misconfigured client fails loudly. Per-protocol versions are negotiated
  inside the connect-time handshake, so protocols on one socket evolve
  independently of the path version.
- **Persisted state** — suffix the storage key: `chats:v2`,
  `settings:v1`. On read, fall back to the prior key and migrate.

Bump on any breaking change to the wire shape: a removed or renamed
required field, a tightened validator, a new required field, a changed
default that shifts behavior. Optional additions don't break existing
parsers — no bump. Ship `v2` alongside `v1` until consumers have
migrated; don't delete the old one the same day.

**Don't version**

- **Same-deploy-unit code** — same-bundle imports, Electron main↔renderer
  IPC, internal types. Both sides change atomically; a version field is
  overhead with no payoff.
- **Adapters over already-versioned external APIs** — a wrapper around a
  third-party SDK inherits that SDK's own versioning as the contract.

The host↔chrome protocol is the canonical versioned contract in this repo:
the compositor and a chrome package ship independently, so
`PROTOCOL_VERSION` is negotiated in the `hello`/`welcome` handshake.
`packages/domicile-protocol` and `@domicile/chrome-sdk/protocol` are the two
halves of that contract and must move together.
