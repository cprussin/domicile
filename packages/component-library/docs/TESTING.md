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
