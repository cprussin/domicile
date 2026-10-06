# Extensions in a shell

The config names Chrome extensions, and the engine installs them into the
browser windows' profile. Content scripts and network rules need nothing from
the shell. The shell draws their toolbar buttons (actions) and popups.

Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md). Design:
[EXTENSIONS.md](/docs/architecture/EXTENSIONS.md). Manganese's tray button:
[`extensions/ExtensionAction.tsx`](/packages/shell-manganese/src/extensions/ExtensionAction.tsx).

## The config

```json
{
  "extensions": {
    "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"],
    "unpacked": ["~/src/my-extension"]
  }
}
```

- `web_store`: Chrome Web Store ids (this one is uBlock Origin Lite).
- `unpacked`: directories, absolute or under `~`.
- Listed extensions install without a prompt and get every permission their
  manifest declares.
- Removing one from the list uninstalls it on reload.

## The list

`domicile.extensions` is the full list; `extensionschanged` reports changes:

```ts
domicile.addEventListener("extensionschanged", () => {
  drawTray((domicile.extensions ?? []).filter(({ enabled }) => enabled));
});
```

| Field | What |
|---|---|
| `id` | What `activateExtension` takes |
| `name` | The extension's name |
| `title` | The action's tooltip and the icon's accessible name |
| `icon` | A `data:image/png` URL at the page's device pixel ratio |
| `badgeText`, `badgeColor` | The badge. `badgeColor` is `#rrggbbaa`, transparent when unset |
| `popup` | The popup's `chrome-extension://` URL, or `null` |
| `enabled` | `false` after `action.disable()` |

The row type is `DomicileExtension`. `extensionSchema`, from
`@domicile-desktop/sdk/extension`, parses one into an `Extension`.

## A click

Call `domicile.activateExtension(id)` on every click, with or without a popup.
This grants `activeTab` on the focused browser window, as Chrome's toolbar
does, so `scripting.executeScript` and `tab.url` work there. Then:

- **No `popup`:** done. The engine fires `action.onClicked`.
- **A `popup`:** open a `<webview extensionpopup>` at that URL in a panel
  under the icon.

```ts
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";

const view = document.createElement("webview");
view.setAttribute("extensionpopup", "");
view.setAttribute("src", extension.popup);
view.addEventListener(WEBVIEW_CLOSE_EVENT, closePanel);
panel.append(view);
```

- **`extensionpopup`:** set it before appending. The engine reads it once.
  Without it the popup loads as a tab, and extensions that lay out by context
  (for example, Bitwarden) render as a full page.
- **Size:** size the view to `contentWidth` and `contentHeight` (0 until laid
  out), announced in `domicile-content-size-change`. Cap them at the panel's
  maximum. The width includes a vertical scrollbar's gutter.
- **Keyboard:** take it with `focusChrome` while the panel is open, and give
  it back on close ([Who gets the keyboard](WRITING-A-SHELL.md#who-gets-the-keyboard)).
- **Closing:** close the panel on `domicile-close` (the popup called
  `window.close()`), on a press outside it, and on Escape. Escape reaches you
  only while your page has focus, not while the popup's page does
  ([The keyboard](SHELL-BROWSER-WINDOWS.md#the-keyboard)).

## Tabs and windows

Every `<webview>` is a tab, and the desktop is one `chrome.windows` window.
The active tab is the view that last took focus. So `view.focus()` sets what
`tabs.query({active: true, currentWindow: true})` returns, and the tray shows
that tab's state.

The browser carries out some extension calls. Others fire an event on a
`<webview>`:

| Extension call | What happens |
|---|---|
| `tabs.create({url})` | A browser window opens and appears in the next `browserwindowschanged` |
| `windows.create({type: "popup", url})` | A browser window opens as that popup window's tab (below) |
| `tabs.remove(id)` | That browser window closes. A view of your own fires `domicile-close` ([Close requests](SHELL-BROWSER-WINDOWS.md#close-requests)) |
| `tabs.update(id, {active: true})`, `windows.update(id, {focused: true})` | `domicile-focus-request` (`WEBVIEW_FOCUS_REQUEST_EVENT`): raise that window |
| `tabs.setZoom(id, factor)` | `domicile-zoom-change`: already applied |

Calls with no desktop meaning (`tabs.move`, `tabs.group`, `tabs.discard`, …)
fail with `not supported on a Domicile desk`.

## Extension popup windows

`chrome.windows.create({type: "popup", url})` (for example, Bitwarden's
"Unlock") opens an ordinary browser window
([The engine owns browser windows](SHELL-BROWSER-WINDOWS.md#the-engine-owns-browser-windows)):

- It is listed with `popupWindow` (its `chrome.windows` id) and the requested
  `width` and `height` (0 if unset). Placement is yours.
- It shows an extension's page, so draw it with no address bar, as Chrome does.
- `windows.remove(popupWindow)` closes it.
- `windows.update(popupWindow, {focused: true})` fires `domicile-focus-request`
  on its view.
