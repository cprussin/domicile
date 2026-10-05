# `<app>` and `<webview>`

How the SDK's input routing works with the engine's two embedding elements.
Event names and full types are in `src/app-element.ts` and
`src/webview-element.ts`.

## `<app>`

`<app app-id="…">` embeds a Wayland client. The engine provides the element.

- **Size:** the element's layout box is the client's size. The engine sends it
  as the `xdg_toplevel.configure`. There is nothing to call.
- **Pointer:** `registerElements` forwards pointer events over an `<app>` to
  the client, in the client's surface coordinates. It inverts CSS transforms
  and `zoom`. It cannot invert a perspective transform; it maps the window flat
  and logs a warning.
- **Keyboard:** page keystrokes go to the window the user last clicked.
  Use `focusApp` / `focusChrome` to move focus in code. The `DomicileClient`
  methods of the same name move only the compositor's seat. `registerElements`
  forwards keystrokes from `document`, so it also has to know which window has
  focus. `focusApp` / `focusChrome` update both.
- **Focus events** (both cancelable; call `preventDefault()` to decide focus
  yourself):
  - `domicile-focus-requested`: a click on a window, before it is focused.
  - `domicile-focus-release-requested`: a press off every window, fired on the
    window that has the keyboard, before focus returns to the page.
- **Context menu:** a right-click over an `<app>` suppresses the browser's
  menu. The press goes to the client, which draws its own. Elsewhere the
  browser menu is left alone.
- No per-element setup. Routing covers every `<app>` on the page, including
  ones added later.

## `<webview>`

`<webview src="…">` embeds a web page. The SDK provides types only.

- **Properties:** `src`, `goBack()`, `goForward()`, `stop()`, `reload()`,
  `canGoBack`, `canGoForward`, `loading`, `focus()`, `inspect()` (opens
  DevTools as a new window).
- **Events** (selected; see `src/webview-element.ts` for all):
  - `domicile-new-window`: a `target="_blank"` link, with `event.url`. The
    engine opens no window itself; if the shell ignores it, the link does
    nothing.
  - `domicile-close`: the page called `window.close()`. The shell removes the
    view.
  - `domicile-context-menu`: a right click the page left alone, with what was
    under it. The shell draws the menu; `event.run(action)` does the browser's
    part of an item.
  - `domicile-content-size-change`: `contentWidth` / `contentHeight` changed.
    Use it to size extension popups.
  - `domicile-popup-window`: an extension called `chrome.windows.create` for a
    popup, with `windowId`, `url`, `width`, `height` (0 if unset). Open a view
    with `popupwindow="<windowId>"` set on first render.
- **Extension popups:** for a tray row with a `popup`, call
  `activateExtension(id)` (which grants `activeTab`), then open a
  `<webview extensionpopup>` at the popup address. Set `extensionpopup` on
  first render.

## Reading held modifiers

Read modifiers from your own `KeyboardEvent`s. The page sees every key press,
whichever window has focus:

```ts
const follow = (event: KeyboardEvent) => {
  // Let clicks reach the page while Alt is held.
  portal.style.pointerEvents = event.altKey ? "none" : "";
};
document.addEventListener("keydown", follow);
document.addEventListener("keyup", follow);
```

Do not use the host's `modifiers` message for this. It reports the
compositor's seat, which only sees keys forwarded while a client had focus.
A modifier pressed while the page had focus is missing from it.
