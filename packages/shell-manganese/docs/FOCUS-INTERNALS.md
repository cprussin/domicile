# Focus internals

How manganese implements the focus behavior in
[WINDOW-MANAGEMENT.md](WINDOW-MANAGEMENT.md).

## Pointer warping

- The page asks the engine to move the pointer with `warpPointer`, in page
  coordinates. The engine picks the monitor.
- `WindowState.pressed` records the key press, so the page for the newly
  focused screen performs the warp.
- Code: `src/window-management/pointer-warp.ts` and `usePointerWarp.ts`.

## Browser-window focus

- The shell decides focus for both window kinds. For clients, the engine sends a
  cancelable `domicile-focus-requested` and the shell handles it.
  `focusedwindowchanged` reports where the keyboard went.
- A click in a `<webview>` sends no pointer or focus events to the shell. The
  element dispatches its own event, which the window listens for.
  `packages/domicile-engine/scripts/guard-webview-click.sh` tests this.
- The engine reports a `<webview>` whose guest has focus as
  `document.activeElement` (patch
  `0011-domicile-let-a-guest-s-focus-reach-the-element-it-ha.patch`).
- A window that already has focus somewhere inside it does not refocus its
  page. This keeps the caret in the address bar.
- When focus leaves a browser window, the window blurs its `<webview>`.
  Otherwise keys would stay in the guest and no other window would get them.

## Dragging over a client

- The pointer over a window goes to its client. While the modifier is held,
  windows get `pointer-events: none` and a transparent sheet on top catches
  the drag.
- The page reads modifiers from its own key events while a Wayland window has
  focus. While a `<webview>` has focus it uses the engine's `modifiers`
  message (`src/keyboard/useModifiers.ts`).
