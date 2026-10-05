# Chrome extensions on a desk

- The desk config lists Chrome extensions. The engine installs them into the
  profile that browser windows use.
- Each extension's action appears in the shell's tray. Its popup opens in a
  `<webview>`.
- To `chrome.tabs`, every `<webview>` is a tab, and the desktop is one
  `chrome.windows` window. Extensions can also open `popup` windows, which the
  shell draws.
- Shell API: [SHELL-EXTENSIONS.md](/docs/SHELL-EXTENSIONS.md).

## Problem

The engine is a `chrome/` build, so the extension system (service workers,
content scripts, `declarativeNetRequest`, `chrome.storage`) is already compiled
in. Three things are missing:

- **Install.** The Web Store install button needs a Chrome browser window. A
  desk has none.
- **Action UI.** Chrome draws the icon and popup in its toolbar. The shell owns
  the whole screen, so there is no toolbar.
- **Tabs.** `chrome.tabs` finds tabs through a browser window's tab strip. A
  `WebViewGuest` is in none, so `tabs.query` returns nothing. Most popups start
  with `tabs.query({active: true, currentWindow: true})`.

## Design

### Installing

```json
{
  "extensions": {
    "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"],
    "unpacked": ["~/src/my-extension"]
  }
}
```

- `web_store`: Web Store ids (this one is uBlock Origin Lite).
- `unpacked`: directories, absolute or under `~`.

| Step | Where |
|---|---|
| Parse, expand `~`, keep the last good config on a bad edit | `domicile-config`, `ExtensionsConfig` |
| Send the list with the handshake and on reload | `domicile-protocol`, `HostMessage::Extensions { web_store, unpacked }` |
| Receive it in the browser process | `components/domicile/browser/control_channel.cc` |
| Decide what to add and remove | `components/domicile/browser/extension_installer.{h,cc}`, `ReconcileExtensions` |
| Install and uninstall in the profile | `chrome/browser/domicile/domicile_extension_installer.{h,cc}` (patch 0055) |

Once `ExtensionSystem::ready()`, reconciling:

- Adds a missing Web Store id via
  `PendingExtensionManager::AddFromExternalUpdateUrl` with
  `extension_urls::GetWebstoreUpdateUrl()`, as `kExternalPrefDownload`. It
  installs and updates from the Store. It is marked acknowledged (Chromium
  disables unacknowledged external extensions on Windows and macOS).
- Loads a missing directory via `UnpackedInstaller::Load`. Failures are logged.
  Paths are compared after `base::MakeAbsoluteFilePath`.
- Uninstalls an extension it added that the list no longer names, with
  `UNINSTALL_REASON_ORPHANED_EXTERNAL_EXTENSION`. The pref
  `domicile.extensions.added` records what it added. It leaves other
  extensions alone.

Listing an extension is consent. There is no install prompt, and manifest
permissions are granted as declared.

Chromium disables unpacked extensions outside developer mode
(`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`). The installer sets
`prefs::kExtensionsUIDeveloperMode` before loading a directory and leaves it
on.

### The tray

`components/domicile/mojom/extension_tray.mojom` carries action state from the
browser process to the shell. It binds on the shell's origin only, like the
control channel, and appears on `window.domicile`:

```ts
// window.domicile
onextensions: (event: DomicileExtensionsEvent) => void;
activateExtension(id: string): void;

interface DomicileExtension {
  id: string;
  name: string;
  title: string;              // the action's tooltip
  icon: string;               // data:image/png, rendered at the page's DPR
  badgeText: string;
  badgeColor: string;         // CSS color, #rrggbbaa
  popup: string | null;       // chrome-extension://<id>/popup.html, or null (undefined in the SDK)
  enabled: boolean;
}
```

- **`onextensions`** sends the full list on every change, so a reloaded page
  gets it again. Sources: `ExtensionRegistryObserver` and
  `ExtensionActionDispatcher::Observer::OnExtensionActionUpdated`.
- **`icon`** is a data URL because `action.setIcon({imageData})` has no URL.
- **Action state** is per tab. The list reports the active tab's state and is
  resent when the active tab changes. With no active tab it reports the
  default (tab `-1`).
- **`activateExtension(id)`** handles every click, as
  `ExtensionActionRunner::RunAction` does for a toolbar click:
  - It grants `activeTab` on the active tab
    (`ActiveTabPermissionGranter::GrantIfRequested`). With no active tab, it
    grants nothing.
  - It dispatches `action.onClicked` with that tab if the action has no popup.
  - Patch 0070 sends the grant to the renderer before `GrantIfRequested`
    returns. Upstream sends it after a network-service round trip, which an
    `onClicked` listener's `executeScript` can beat.
- **Popups.** If the action has a popup, the shell opens
  `<webview extensionpopup src={popup}>` in a panel under the icon.
  - The page gets the full extension API from its `chrome-extension://`
    origin.
  - The popup's `window.close()` fires `domicile-close` on the element
    (`WebViewGuestClient.CloseRequested`).
  - The guest has view type `kExtensionPopup`, no tab id and no desk window,
    like Chrome's toolbar bubble. So `runtime.getContexts` lists it as
    `POPUP`, `tabs.getCurrent()` returns nothing, and
    `tabs.query({active: true, currentWindow: true})` returns the desk's
    active tab. Some extensions depend on this: Bitwarden sets a 380px body
    width only when `tabs.getCurrent()` finds no tab.
- **Panel size** fits the popup's content, like Chrome's bubble. The guest
  runs in preferred-size mode (`WebViewGuest::PrimaryPageChanged`) and reports
  max-content width and document height as `contentWidth` / `contentHeight`
  and `domicile-content-size-change` (`WebViewGuestClient.ContentSizeChanged`).
  Patches:
  - 0080: report size from a guest's main frame.
  - 0081: report after any layout, not only on commit.
  - 0082: use max-content width. Min-content width of a fluid page is its
    longest word.

SDK side: the `window.domicile` client in `packages/chrome-sdk`, and the tray
and popup panel in `packages/shell-manganese/src/extensions/`.

### Tabs

| Chrome | On a desk |
|---|---|
| Tab | A `WebViewGuest` with view type `kTabContents` |
| Window | One `DomicileWindowController : extensions::WindowController` in `WindowControllerList`. Its tabs are the live guests in creation order. |
| Active tab | The guest whose element last took focus. Extension pages (popup windows, action popups) never become the active tab. |

Patch 0056 attaches two helpers to every tab guest on creation:

- `SessionTabHelper`: tab id, read by `declarativeNetRequest` `tabIds` and
  `webRequest`.
- `extensions::TabHelper`: `activeTab`, `scripting.executeScript`.

The browser gets no focus notification for an inner `WebContents`, so the
element reports it (`WebViewGuest.Focused`).

Chrome's lookups walk browser windows. Patch 0057 adds one hook call to each
of four lookups, declared in
`chrome/browser/extensions/domicile_desk_hooks.h`:

| Lookup | Desk answer |
|---|---|
| `ExtensionTabUtil::GetTabById` | the guest, the desk's controller, its index |
| `ExtensionTabUtil::CreateTabObject` | its index and `active` |
| `ExtensionTabUtil::ForEachTab` | every guest too |
| `ChromeExtensionFunctionDetails::GetCurrentWindowController` | the desk, since the shell's own window is not a desk window |

- `tabs.query` and the mutations below are the desk's own
  `ExtensionFunction`s. They replace Chrome's by name in
  `ExtensionFunctionRegistry::Register`.
- Tab events (`onCreated`, `onUpdated`, `onRemoved`, `onActivated`,
  `onZoomChange`) come from the guests' lifecycle. They are built as
  `TabsEventRouter` builds them and broadcast through the profile's
  `EventRouter`. `TabsEventRouter` itself can't be used: its dispatch is
  private and it `CHECK`s for a `TabInterface` that guests lack.

Mutations:

| Call | Handled by |
|---|---|
| `tabs.create({url})` | The browser opens a browser window (`domicile_browser_windows.h`). Resolves with the next new tab. |
| `tabs.update(id, {url})`, `{muted}` | The guest |
| `tabs.update(id, {active: true})`, `windows.update(id, {focused: true})` | The shell, as `domicile-focus-request` on that element |
| `tabs.remove(id)` | The browser closes that browser window. A shell's own `<webview src>` gets `domicile-close`. Resolves immediately. |
| `windows.get`, `getCurrent`, `getLastFocused`, `getAll` | The desk |
| `windows.create({type: "popup", url})` | A popup window (below) |
| `windows.remove(id)` | A popup window's tab, as `tabs.remove`. Refused for the desk window. |
| `tabs.setZoom`, `getZoom` | The guest: `WebViewGuest::ZoomTo`, per site via `HostZoomMap`. The element gets `domicile-zoom-change`. `0` is the default. Values outside Blink's browser range are refused. |
| `tabs.getZoomSettings`, `setZoomSettings` | The desk: `automatic`, `per-origin` only. Other settings are refused. |
| `tabs.move`, `group`, `ungroup`, `discard`, `duplicate`, `createSplit`, `unsplit`; `tabs.update`'s `pinned`, `openerTabId`, `autoDiscardable`; `windows.update` bounds and state; any `windows.create` other than a `popup` with one `url` | Error: `not supported on a Domicile desk` |

### Popup windows

Bitwarden signs in with `windows.create({type: "popup", url, width, height})`
and closes it with `windows.remove`. A popup window is a second
`DomicileWindowController` of type `popup`, owned by the desk's controller
(`domicile_window_controller.{h,cc}`):

1. `windows.create` makes an empty window and fires `windows.onCreated`
   (`OpenPopup`).
2. The browser opens a browser window at `url` as the window's only tab
   (`WebViewGuest::RequestPopupWindow`, `BrowserWindowHost::OpenPopupWindow`,
   `AddToDesk`).
3. The shell gets it in `browserwindowschanged` with `popupWindow`, `width`
   and `height` (0 if unset), and draws it.
4. `windows.create` resolves with the populated window (`WhenNextTab`).
5. `windows.remove` or the page's `window.close()` closes that browser window.
   The window closes with its tab and fires `windows.onRemoved`
   (`DeskWindowsRemoveFunction`, `PopupEmptied`).

| Call | A popup window |
|---|---|
| `windows.getCurrent`, `tabs.query({currentWindow})` | Itself from its own page. The desk from a service worker. |
| `windows.getLastFocused`, `lastFocusedWindow` | Itself after its tab takes focus, until a desk tab does |
| `windows.getAll`, `tabs.query({windowType})` | Listed with the desk, filtered by type |
| `windows.update(id, {focused: true})` | `domicile-focus-request` on its element |

The desk window reports `left: 0, top: 0`. Bitwarden positions its popup
relative to the source window and passes `NaN` without them.

## Key decisions

- **Config over a store UI.** Home-manager writes the config, and the Store
  flow needs a browser window.
- **Compositor sends the list; the launcher does not pass `--load-extension`.**
  The launcher never reads the config, Chromium disables the switch by default
  (`DisableLoadExtensionCommandLineSwitch`), it can't name a Web Store id, and
  it doesn't follow a reload.
- **Default profile.** Browser windows use it (see `web_view_guest.h`, *NO
  GUEST SiteInstance*), so content scripts and network rules see the pages the
  user browses.
- **One window for all `<webview>`s.** Extensions expect many tabs and one
  active tab per window.
- **Refuse unsupported calls.** A no-op `tabs.move` that reports success is a
  bug the extension can't detect.
- **Popup windows are real windows.** They have their own id, so
  `windows.remove` closes them and `tabs.query({windowType: "popup"})` finds
  them. The engine owns the window and its page, and the shell draws it.
- **Only `popup` windows.** A `normal` window is a shell browser window, which
  `tabs.create` already requests. Size is passed through. Position is the
  shell's choice, as under Wayland in Chrome.
- **Passkeys come from extensions.** The browser draws no WebAuthn UI (patch
  0048), so a password manager extension provides passkeys, by wrapping
  `navigator.credentials` in a content script or via
  `chrome.webAuthenticationProxy`. For conditional `get()` the browser reports
  conditional UI as available and holds the request until the site aborts it
  (patch 0084). Bitwarden races its own answer against the browser's, so a
  browser refusal left it answering a page that had stopped listening.
  `guard-webview-passkey-extension.sh` checks that an extension answers a
  page's WebAuthn request in a `<webview>`, by content script and by
  `webAuthenticationProxy`.
- **Manifest V3 only.** Chromium at the pin no longer loads MV2. uBlock Origin
  Lite works; uBlock Origin does not.

## Not in scope

- `chrome.contextMenus`: the desk disables the context menu (#608).
- `chrome.commands`: shortcuts belong to the shell. Use `grabShortcut` if
  needed.
- Install, permission and "extension added" bubbles (see Installing).

## Tests

Engine guards in `packages/domicile-engine/scripts/`:

- `guard-extension-installer.sh`
- `guard-extension-tray.sh`
- `guard-webview-content-script.sh`
- `guard-webview-tabs.sh`
- `guard-webview-active-tab.sh`
- `guard-webview-popup-window.sh`
- `guard-webview-passkey-extension.sh`
