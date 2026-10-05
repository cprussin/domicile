# `<app>` and `<webview>`

How the SDK's input routing works with the engine's two embedding elements.
Event names and full types are in `src/app-element.ts` and
`src/webview-element.ts`.

## `<app>`

`<app app-id="…">` embeds a Wayland client. The engine provides the element.

- **Size:** the element's layout box is the client's size. The engine sends it
  as the `xdg_toplevel.configure`. There is nothing to call.
- **Scale:** call `DomicileClient.setAppBounds(appId, box)` with the
  element's box in page pixels whenever it moves or resizes. The client draws
  at the scale of the monitor holding most of the box. An unreported window
  draws for the densest monitor.
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

`<webview src="…">` embeds a web page. `<webview window="id">` shows one of
the desk's browser windows, which the engine owns; the engine reads `window`
once, when the view connects. The SDK provides types only.

- **Properties:** `src`, `goBack()`, `goForward()`, `stop()`, `reload()`,
  `canGoBack`, `canGoForward`, `loading`, `focus()`, `inspect()` (opens
  DevTools as a new window).
- **Events** (selected; see `src/webview-element.ts` for all):
  - `domicile-close`: the page in a shell's own view (no `window`) called
    `window.close()`. The shell removes the view. A browser window closes in
    the browser.
  - `domicile-focus-request`: the page called `window.focus()` or
    `client.focus()` (how a site answers a click on its notification), or an
    extension asked for the tab. The shell raises the view.
  - `domicile-context-menu`: a right click the page left alone, with what was
    under it. The shell draws the menu; `event.run(action)` does the browser's
    part of an item.
  - `domicile-content-size-change`: `contentWidth` / `contentHeight` changed.
    Use it to size extension popups.
- **Browser windows:** `DomicileClient.on("browser_windows", …)` delivers the
  desk's whole list. `openBrowserWindow(url)` and `closeBrowserWindow(id)` are
  for the shell's own UI. A link with `target="_blank"`, `domicile open-url`
  and an extension's `tabs.create` or `windows.create` open windows without
  the shell. See
  [SHELL-BROWSER-WINDOWS.md](/docs/SHELL-BROWSER-WINDOWS.md).
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
