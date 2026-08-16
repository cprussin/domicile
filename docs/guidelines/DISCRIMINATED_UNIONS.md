# Discriminated unions

How to define a discriminated union — a union whose members share a common
"tag" field that distinguishes them. See also
[CONTROL_FLOW.md](./CONTROL_FLOW.md) for switching over one exhaustively, and
[DATA.md](./DATA.md) for the wire-format exception below.

## Enum + constructor + derived type

When you define a discriminated union, **do not** hand-write the member types
with naive string discriminants. Instead:

1. Declare the discriminant as a TypeScript `enum`.
2. Define a `const` **constructor object** whose methods build each variant,
   tagging the discriminant with `<Enum>.<Member> as const`. The constructor
   methods are named in **PascalCase** (`ModelDelta.TextDelta`,
   `ApprovalResult.Deny`) — they are variant constructors, not ordinary
   verbs.
3. **Derive** the union type from the constructor's return types via
   `ReturnType`.

The enum is the single source of truth for the variants, the constructors are
the only way variants are built (so every call site stays consistent), and the
type follows automatically — adding a variant is one edit to the enum plus one
constructor, and exhaustiveness checking (see *Prefer `switch`* in
[CONTROL_FLOW.md](./CONTROL_FLOW.md)) flags every site that must handle it.

```ts
// wrong — naive string discriminant, type written by hand
export type ApprovalResult =
  | { decision: "allow"; args: unknown }
  | { decision: "deny"; reason?: string };

// correct — enum discriminant, constructors, type derived from them
export enum ApprovalDecision {
  Allow,
  Deny,
}

export const ApprovalResult = {
  Allow: (args: unknown) => ({ args, decision: ApprovalDecision.Allow as const }),
  Deny: (reason?: string) =>
    reason === undefined
      ? { decision: ApprovalDecision.Deny as const }
      : { decision: ApprovalDecision.Deny as const, reason },
};

export type ApprovalResult = ReturnType<
  (typeof ApprovalResult)[keyof typeof ApprovalResult]
>;
```

A scalar enumeration that is only ever a field value (no per-variant payload,
so no constructor object earns its keep) is just a plain `enum` — the
constructor/`ReturnType` machinery applies to unions of object shapes.

## The memory format always uses enums

An enum discriminant's runtime value is not a stable string, so this pattern is
for the **in-memory** representation — the format your own code constructs,
switches on, and passes around in-process. That is the default for every
discriminated union.

The **only** exception is a union that *is* itself a wire format: a contract
serialized across a runtime boundary (see [DATA.md](./DATA.md)) — a
`protocol-*` frame, a persisted record, a payload sent to a model provider.
Those keep string-literal discriminants because the string *is* the contract,
and they are authored as the Zod schema that parses the boundary (the schema is
the source of truth; `ReturnType` would delete it).

When an in-memory enum union must cross such a boundary, **do not** leak the
enum onto the wire. Map between the memory enum and the wire string in an
explicit serializer / deserializer at the boundary — a Zod codec is the
natural tool for a bidirectional mapping. The wire schema and the memory enum
stay independent, free to use different vocabularies, and the conversion lives
in exactly one place.

## Wire-format unions still get constructors

Keeping the string discriminant does **not** mean producers scatter object
literals. A wire-format union gets the same constructor-object surface as an
in-memory one — build frames through `Frame.Variant(...)` constructors so
every producer goes through one place — only the types flow the other way:

- The union type stays `z.infer<typeof schema>` (the schema is the source of
  truth — it carries the validation, and it is what the parse boundary uses).
  Do **not** derive it from the constructors via `ReturnType`.
- Each constructor's **return type is pinned to that** `z.infer<…>`, so a
  constructor that drifts from its schema is a compile error.
- A coverage assertion — the union of the constructors' return types equals the
  schema's inferred union — catches a variant that loses its constructor.

```ts
const textDeltaSchema = z.object({
  text: z.string(),
  type: z.literal("text_delta"),
});
type TextDelta = z.infer<typeof textDeltaSchema>;

export const LoopMessage = {
  // one PascalCase constructor per frame, each return-typed as its schema's
  // `z.infer` — the schema, not the constructor, is the source of truth
  TextDelta: (text: string): TextDelta => ({ text, type: "text_delta" }),
  // …
};
```
