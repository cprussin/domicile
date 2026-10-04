# Testing

Package-specific rules. General rules are in
[/docs/guidelines/TESTING.md](/docs/guidelines/TESTING.md).

Tests use `bun:test` and `@testing-library/react`.

## Coverage expectations

Each component's tests cover:

- **Rendering:** expected text and ARIA roles appear.
- **Interactions:** clicks and input fire callbacks or change the DOM.
- **Conditional rendering:** props that show or hide elements work in each
  combination.

## Selectors

- Prefer `getByRole`, `getByLabelText` and `getByText` over
  `container.querySelector(...)`.
- Use a stable `data-*` attribute only when there is no role or label to
  query. Example: `[data-resize-handle]` on the `Textarea` resize handle.
  Add a role or label first if you can.

## Asserting something is gone

Use `waitForElementToBeRemoved`:

```ts
await waitForElementToBeRemoved(() => screen.queryByText("Too short"));
```

Don't wrap `expect(...).not.toBeInTheDocument()` in `waitFor`:

- `waitForElementToBeRemoved` fails if the element was never there. The
  `waitFor` version passes.
- `waitFor` runs once before anything unmounts, so the matcher always fails at
  least once. Each failure builds an error message from the DOM.
  `waitForElementToBeRemoved` builds no message per poll.

`expect(...).not.toBeInTheDocument()` is fine as a one-time assertion.
