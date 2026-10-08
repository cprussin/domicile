# `<app>` and `<webview>`

How the engine's two embedding elements route input and focus.
Event names and full types are in `src/app-element.ts` and
`src/webview-element.ts`.

## `<app>`

`<app app-id="…">` embeds a Wayland client. The engine provides the element.

- **Size:** the element's layout box is the client's size. The engine sends it
  as the `xdg_toplevel.configure`. There is nothing to call.
- **Scale:** call `domicile.setAppBounds(appId, x, y, width, height)` with
  the element's box in page pixels whenever it moves or resizes. The client
  draws at the scale of the monitor holding most of the box. An unreported
  window draws for the densest monitor.
- **Pointer:** the element sends pointer and wheel events over it to the
  client, in the client's surface coordinates, through its layout box and
  every transform above it (`zoom` and perspective included). A
  `preventDefault()` on the event takes it from the client.
- **Keyboard:** the engine sends the keystrokes `document` hears to the window
  that has the keyboard. `domicile.focusApp(appId)` and `domicile.focusChrome()`
  move it in code, both in the compositor's seat and for the page's keys.
- **Focus events** (both cancelable; call `preventDefault()` to decide focus
  yourself):
  - `domicile-focus-requested`: a click on a window, before it is focused. A
    popup's click asks for its window.
  - `domicile-focus-release-requested`: a press off every window, fired on the
    window that has the keyboard, before focus returns to the page.
- **Context menu:** a right-click over an `<app>` suppresses the browser's
  menu. The press goes to the client, which draws its own. Elsewhere the
  browser menu is left alone.
- No setup. Routing covers every `<app>` on the page, including ones added
  later.

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
- **Browser windows:** `domicile.browserWindows` is the desk's whole list;
  `browserwindowschanged` reports changes. `openBrowserWindow(url)` and `closeBrowserWindow(id)` are
  for the shell's own UI. A link with `target="_blank"`, `domicile open-url`
  and an extension's `tabs.create` or `windows.create` open windows without
  the shell. See
  [SHELL-BROWSER-WINDOWS.md](/docs/SHELL-BROWSER-WINDOWS.md).
- **Extension popups:** for a tray row with a `popup`, call
  `activateExtension(id)` (which grants `activeTab`), then open a
  `<webview extensionpopup>` at the popup address. Set `extensionpopup` on
  first render.
- **Private pages:** `<webview private>` puts a shell's own page in the
  off-the-record profile, and `openPrivateBrowserWindow(url)` opens a private
  window. Set `private` on first render. See
  [SHELL-BROWSER-WINDOWS.md](/docs/SHELL-BROWSER-WINDOWS.md#private-browsing).

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

Do not use the host's `altKey`, `ctrlKey`, `shiftKey` and `metaKey` for this.
They report the compositor's seat, which only sees keys forwarded while a
client had focus. A modifier pressed while the page had focus is missing from
them.
