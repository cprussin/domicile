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

`extensions` arrives with the full list on every change and on connect:

```ts
domicile.on("extensions", ({ extensions }) => {
  drawTray(extensions.filter(({ enabled }) => enabled));
});
```

| Field | What |
|---|---|
| `id` | What `activateExtension` takes |
| `name` | The extension's name |
| `title` | The action's tooltip and the icon's accessible name |
| `icon` | A `data:image/png` URL at the page's device pixel ratio |
| `badgeText`, `badgeColor` | The badge. `badgeColor` is `#rrggbbaa`, transparent when unset |
| `popup` | The popup's `chrome-extension://` URL, or `undefined` |
| `enabled` | `false` after `action.disable()` |

The row type is `Extension`, from `@domicile-desktop/sdk/extension`.

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

Extension calls arrive as events on a `<webview>`:

| Extension call | Event on the `<webview>` |
|---|---|
| `tabs.create({url})` | `domicile-new-window`, on the active tab's view |
| `windows.create({type: "popup", url})` | `domicile-popup-window`, on the active tab's view (below) |
| `tabs.remove(id)` | `domicile-close`: close that window ([Close requests](SHELL-BROWSER-WINDOWS.md#close-requests)) |
| `tabs.update(id, {active: true})`, `windows.update(id, {focused: true})` | `domicile-focus-request` (`WEBVIEW_FOCUS_REQUEST_EVENT`): raise that window |
| `tabs.setZoom(id, factor)` | `domicile-zoom-change`: already applied |

Calls with no desktop meaning (`tabs.move`, `tabs.group`, `tabs.discard`, …)
fail with `not supported on a Domicile desk`.

## Extension popup windows

`chrome.windows.create({type: "popup", url})` (for example, Bitwarden's
"Unlock") fires `domicile-popup-window` on the active tab's view with:

- `windowId`: the window's `chrome.windows` id
- `url`
- `width`, `height`: the requested size, or 0. Placement is yours.

Open a browser window whose `<webview>` has `popupwindow` set to `windowId`:

```ts
import { WEBVIEW_POPUP_WINDOW_EVENT } from "@domicile-desktop/sdk/webview-element";

frame.addEventListener(WEBVIEW_POPUP_WINDOW_EVENT, (event) => {
  const view = document.createElement("webview");
  view.setAttribute("popupwindow", String(event.windowId)); // before append
  view.setAttribute("src", event.url);
  openPopupWindow(view, event.width, event.height);
});
```

- **`popupwindow`:** set it before appending. The engine reads it once. In React,
  setting it in JSX on first render works. Never remount that view; a remount
  creates a second guest.
- From then on, `windows.remove(windowId)` fires `domicile-close` on it and
  `windows.update(windowId, {focused: true})` fires `domicile-focus-request`.
- If you ignore the event, the window never opens and `windows.create` never
  returns.
