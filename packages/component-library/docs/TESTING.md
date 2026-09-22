# Testing

See `/docs/guidelines/TESTING.md` for the general testing rules (test all new
behavior, TDD, semantic selectors, grouped describes). Component-library
specifics below.

## Stack

- `bun:test` + `@testing-library/react`.

## Coverage expectations

For each component, cover:

- **Rendering** — the component appears with expected text and ARIA roles.
- **Interactions** — clicks / inputs trigger expected callbacks or DOM
  state changes.
- **Conditional rendering** — props that toggle elements on or off behave
  correctly across the matrix.

## Selectors

Prefer accessibility / semantic selectors (`getByRole`, `getByLabelText`,
`getByText`) over `container.querySelector(...)`. Tests that rely on
implementation details break for unrelated reasons.

Stable `data-*` attributes are an acceptable selector when no semantic seam
exists — e.g. `container.querySelector("[data-resize-handle]")` for the
Textarea resize handle, since there's no ARIA role for "resize affordance".
Use them sparingly; prefer adding a role / label first if possible.

## Asserting something is gone

To wait for an element to disappear, use `waitForElementToBeRemoved`:

```ts
await waitForElementToBeRemoved(() => screen.queryByText("Too short"));
```

Not a `waitFor` around `expect(...).not.toBeInTheDocument()`. A poll is
evaluated once synchronously, before anything has had a chance to unmount, so
that matcher is expected to fail at least once, and a failing matcher has to
build a message. `waitForElementToBeRemoved` polls on the query's result and
throws an error it built up front, so a failing poll formats nothing at all.
It also asserts the element was there to begin with, which the matcher does
not — force the popup open and the case fails, where a poll for its absence
would pass.

The message is why this was once a timeout rather than a style point.
jest-dom builds it with `stringify(element.cloneNode(true))`, and bun's
inspector used to answer that by walking a happy-dom node's property graph out
through `ownerDocument` into the whole rendered tree: 190MB and five to nine
seconds for one failed poll on the Field error popover, growing with the size
of the document. `@domicile/test-support`'s preload now answers the inspection
with the node's own markup instead
([`node-inspection.ts`](/packages/test-support/src/node-inspection.ts)), so
that charge is gone — a failed poll there measures 1ms. The reasons above
stand without it.

The matcher is fine as a one-shot assertion that passes; a retry loop is what
makes its failure routine.
