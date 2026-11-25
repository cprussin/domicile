# Extensions in a shell

The config names Chrome extensions, and the engine installs them into the
browser windows' profile. Content scripts and network rules need nothing from
the shell. The shell draws their toolbar buttons (actions) and popups.

Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md). Design:
[EXTENSIONS.md](/docs/architecture/EXTENSIONS.md). Manganese's tray button:
[`extensions/ExtensionAction.tsx`](/packages/manganese-bar-module-tray/src/extensions/ExtensionAction.tsx).

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
  manifest declares. Camera, microphone and the other site permissions are
  asked for like a site's.
- Removing one from the list uninstalls it on reload.
- `domicile load-extension <directory>` loads an unpacked extension, or
  reloads it after an edit, without a restart
  ([CLI.md](CLI.md#domicile-load-extension-directory)).

## The list

`domicile.extensions.list` is the full list; `extensions.on("change")`
reports changes:

<!-- tab: React -->

```tsx
const Tray = () => {
  const { extensions } = useDomicile();
  const list = useWatch(extensions, "change", () => extensions.list) ?? [];
  return list
    .filter(({ enabled }) => enabled)
    .map((extension) => <TrayIcon extension={extension} key={extension.id} />);
};
```

<!-- tab: JavaScript -->

```js
domicile.extensions.on("change", () => {
  drawTray((domicile.extensions.list ?? []).filter(({ enabled }) => enabled));
});
```

<!-- /tabs -->

| Field | What |
|---|---|
| `id` | What `extensions.activate` takes |
| `name` | The extension's name |
| `title` | The action's tooltip and the icon's accessible name |
| `icon` | A `data:image/png` URL at the page's device pixel ratio |
| `badgeText`, `badgeColor` | The badge. `badgeColor` is `#rrggbbaa`, transparent when unset |
| `popup` | The popup's `chrome-extension://` URL, or `null` |
| `enabled` | `false` after `action.disable()` |

The row type is `DomicileExtension`. `extensionSchema`, from
`@domicile-desktop/sdk/extension`, parses one into an `Extension`.

## A click

Call `domicile.extensions.activate(id)` on every click, with or without a popup.
This grants `activeTab` on the focused browser window, as Chrome's toolbar
does, so `scripting.executeScript` and `tab.url` work there. Then:

- **No `popup`:** done. The engine fires `action.onClicked`.
- **A `popup`:** open a `<webview extensionpopup>` at that URL in a panel
  under the icon.

An extension can also ask for its popup with `action.openPopup()`. Phantom
does this from `action.onClicked`, so its row has no `popup`.
`extensions.on("popup", ({ id, popup }) => …)` reports the request: open
`popup` under `id`'s icon as for a click. The request carries the URL because
the extension may clear its row's `popup` straight after.

<!-- tab: React -->

```tsx
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";

const Popup = ({ extension, onClose }) => {
  const viewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const view = viewRef.current;
    view?.addEventListener(WEBVIEW_CLOSE_EVENT, onClose);
    return () => view?.removeEventListener(WEBVIEW_CLOSE_EVENT, onClose);
  }, [onClose]);
  return <webview extensionpopup="" ref={viewRef} src={extension.popup} />;
};
```

<!-- tab: JavaScript -->

```js
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";

const view = document.createElement("webview");
view.setAttribute("extensionpopup", "");
view.setAttribute("src", extension.popup);
view.addEventListener(WEBVIEW_CLOSE_EVENT, closePanel);
panel.append(view);
```

<!-- /tabs -->

- **`extensionpopup`:** set it before appending. The engine reads it once.
  Without it the popup loads as a tab, and extensions that lay out by context
  (for example, Bitwarden) render as a full page.
- **Size:** size the view to `contentWidth` and `contentHeight` (0 until laid
  out), announced in `domicile-content-size-change`. The page sizes itself as
  in Chrome, between 25x25 and 800x600, and scrolls past that.
- **Showing:** show the panel once the page has sized itself and `loading` is
  false, as Chrome does. While it loads it is still growing.
- **Keyboard:** take it with `windows.focusShell` while the panel is open, and give
  it back on close ([Who gets the keyboard](WRITING-A-SHELL.md#who-gets-the-keyboard)).
- **Closing:** close the panel on `domicile-close` (the popup called
  `window.close()`), on a press outside it, and on Escape. Escape reaches you
  only while your page has focus, not while the popup's page does
  ([The keyboard](SHELL-BROWSER-WINDOWS.md#the-keyboard)).
- **Permissions:** the popup fires `domicile-permission-request` like a
  browser window ([Permissions](SHELL-BROWSER-WINDOWS.md#permissions)).
  Unclaimed, the extension gets nothing. A choice is stored for the
  extension's `chrome-extension://` origin, so it holds in all its pages.

## Commands

The engine runs extensions' keys (`chrome.commands`) as Chrome does: a key
pressed in a `<webview>` runs the command in that page's profile, and the page
does not get the key. A shell needs no code for it.

To run them yourself, listen. The engine then runs none:

<!-- tab: React -->

```tsx
const ExtensionKeys = () => {
  const { extensions } = useDomicile();
  useEffect(
    () =>
      extensions.on("commandPressed", ({ id, name, profile }) => {
        extensions.setProfile(profile);
        extensions.runCommand(id, name);
      }),
    [extensions],
  );
  return null;
};
```

<!-- tab: JavaScript -->

```js
domicile.extensions.on("commandPressed", ({ id, name, profile }) => {
  domicile.extensions.setProfile(profile);
  domicile.extensions.runCommand(id, name);
});
```

<!-- /tabs -->

- An extension may have any key, Chrome's own shortcuts too, such as Ctrl+T.
  The desk's shortcuts (`grabShortcut`) come first, then extensions' keys, then
  the page, then `domicile-guest-keydown`.
- `extensions.reserveKeys(["Ctrl+T", "Ctrl+W"])` keeps keys your shell handles
  from extensions. A command bound to one has no keys. Nothing is reserved
  otherwise.
- `extensions.commands` lists every extension with commands, with an action or
  without, and the keys bound to them. `extensions.on("commands")` reports
  changes. The list is that of the profile given to `extensions.setProfile`.
- `runCommand` acts on the active tab, as a key does in Chrome.
- `_execute_action` runs the action as Chrome's key does: nothing when it is
  disabled, and `extensions.on("popup")` when it has a popup.

## Menus

- **The action's menu:** `await extensions.menu(id)` gives the items the
  extension adds to it, as `appMenu` gives a menu bar's entries: submenus,
  checkboxes, radio items and separators. `extensions.runMenuItem(entry.id)`
  runs one on the active tab. Ask again for each menu you open: the items and
  ids change.
- **A page's menu:** `domicile-context-menu` carries the items that match the
  click. `appMenu(event.extensionItems)` reads them, and
  `event.runExtensionItem(entry.id)` runs one.

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
| `action.openPopup()` | `extensions.on("popup")`: open that popup ([A click](#a-click)) |
| `sidePanel.open()` | A popup window showing the side panel, with no size (0 by 0), in `browserwindowschanged`: tile it; a second call sends `domicile-focus-request` for it. `sidePanel.close()` closes it |

Calls with no desktop meaning (`tabs.move`, `tabs.group`, `tabs.discard`, …)
and `tabs.detectLanguage` fail with `not supported on a Domicile desk`.

## Extension popup windows

`chrome.windows.create({type: "popup", url})` (for example, Bitwarden's
"Unlock") opens an ordinary browser window
([The engine owns browser windows](SHELL-BROWSER-WINDOWS.md#the-engine-owns-browser-windows)):

- It is listed with `popupWindow` (its `chrome.windows` id) and the requested
  `width` and `height` (0 if unset). Placement is yours. Manganese floats one
  with a size and tiles one without, such as a side panel.
- It shows an extension's page, so draw it with no address bar, as Chrome does.
- `windows.remove(popupWindow)` closes it.
- `windows.update(popupWindow, {focused: true})` fires `domicile-focus-request`
  on its view.
