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
that matcher is expected to fail at least once — and jest-dom builds its
failure message with `stringify(element.cloneNode(true))`, which on a
happy-dom node walks the property graph out through `ownerDocument` and
serializes the whole rendered tree. Measured on the Field error popover, one
failed poll cost five to nine seconds, and the cost grows with the size of the
document. It is a wall-clock charge for a test that is otherwise correct, and
it is what turns a passing case into a timeout when turbo runs the workspace
suites at once.

`waitForElementToBeRemoved` polls on the query's result and throws an error it
built up front, so a failing poll serializes nothing. It also asserts the
element was there to begin with, which the matcher does not.

The same matcher is fine as a one-shot assertion that passes — it is only the
failure path that is expensive, and only a retry loop makes failure routine.
