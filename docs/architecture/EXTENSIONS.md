# Chrome extensions on a desk

A desk's config names Chrome extensions, and the engine installs them into the
profile its browser windows already use. Each extension's action shows in the
shell's tray and opens its popup in a `<webview>`. To `chrome.tabs`, every
`<webview>` is a tab, and the whole desktop is one `chrome.windows` window —
plus a `popup` window for each one an extension opens, which the shell draws.

## Problem

The engine is a `chrome/` build. The extension system — background service
workers, content scripts, `declarativeNetRequest`, `chrome.storage` — is
compiled in, and nothing turns it off. Three things are missing:

| Missing | Why |
|---|---|
| A way to install one | The Web Store's install button is `webstorePrivate` talking to a Chrome browser window; a desk has none. |
| A place for the action | Chrome draws the icon and popup in its toolbar, which a desk has no room for, because the shell owns the whole screen. |
| Tabs | `chrome.tabs` finds a tab through a browser window's tab strip. A `WebViewGuest` is in none, so `tabs.query` returns nothing, and most popups start with `tabs.query({active: true, currentWindow: true})`. |

## Design

### Installing: the config names them

```toml
[extensions]
web_store = ["ddkjiahejlhfcafbddmgiahcphecmpfh"]  # uBlock Origin Lite
unpacked = ["~/src/my-extension"]                 # absolute, or under `~`
```

| Step | Where |
|---|---|
| Parse `[extensions]`, expand a leading `~`, keep-last-good on a bad edit | `domicile-config`, `ExtensionsConfig` |
| Send the list as a fact that rides the handshake, like `Keymap`, and again on reload | `domicile-protocol`, `HostMessage::Extensions { web_store, unpacked }` |
| Intercept it in the browser process, as `Keymap` is | `components/domicile/browser/control_channel.cc` |
| Decide what to add and remove | `components/domicile/browser/extension_installer.{h,cc}`, `ReconcileExtensions` |
| Carry it out in the page's profile | `chrome/browser/domicile/domicile_extension_installer.{h,cc}`, bound by patch 0055 |

Reconciling does three things, once `ExtensionSystem::ready()`:

- A Web Store id not installed goes to `PendingExtensionManager::AddFromExternalUpdateUrl` with `extension_urls::GetWebstoreUpdateUrl()`, as `kExternalPrefDownload`, acknowledged. It installs from the Store and updates from it.
- A directory not already loaded goes to `UnpackedInstaller::Load`, silent on failure (the error is logged). Directories are compared after `base::MakeAbsoluteFilePath`, as the installer records them.
- An extension this installer added that the list no longer names is uninstalled with `UNINSTALL_REASON_ORPHANED_EXTERNAL_EXTENSION`, which neither asks policy nor marks it user-removed. What it added is the profile pref `domicile.extensions.added`. Anything else in the profile is left alone.

Naming an extension in the config is the consent. There is no install prompt,
and the manifest's permissions are granted as declared.

Two things Chromium does to an extension installed this way, at the pin:

| Chromium | On a desk |
|---|---|
| `ExtensionRegistrar` disables an unacknowledged external extension (`DISABLE_EXTERNAL_EXTENSION`) only where `FeatureSwitch::prompt_for_external_extensions` is on: Windows and macOS. | Never applies on Linux. The Web Store add passes `mark_acknowledged` anyway. |
| `StandardManagementPolicyProvider` disables a `kUnpacked` extension in a profile not in developer mode (`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`). | The installer sets `prefs::kExtensionsUIDeveloperMode` before loading a directory, and leaves it on. |

### The tray: engine to page

The action's state lives in the browser process, so a new mojo interface
carries it. `components/domicile/mojom/extension_tray.mojom` is bound on the
shell's origin only, exactly as the control channel is, and is surfaced on
`window.domicile`:

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
  popup: string | null;       // chrome-extension://<id>/popup.html; the SDK says undefined
  enabled: boolean;
}
```

- **`extensions` is the whole list, on every change.** Like `Displays`, a page that reloads is told again rather than having had to be listening. The source is `ExtensionRegistryObserver` plus `ExtensionActionDispatcher::Observer::OnExtensionActionUpdated`.
- **The icon is a data URL, not a `chrome-extension://` URL.** `action.setIcon({imageData})` sets an icon that has no URL.
- **Action state is per tab**, so the list reports it for the active tab, and is sent again when the active tab changes. With no active tab it is the default state (tab `-1`).
- **Every click is `activateExtension(id)`**, popup or not: what `ExtensionActionRunner::RunAction` does for a toolbar click, which the tray bypasses. It grants `activeTab` on the active tab (`ActiveTabPermissionGranter::GrantIfRequested`, on the guest's `extensions::TabHelper`), then dispatches `action.onClicked` with that tab only when the action has no popup. With no active tab, nothing is granted: the page clicked in is the shell's. The grant reaches the tab's renderer before `GrantIfRequested` returns (patch 0070); upstream sends it only after a network-service round trip, which an `onClicked` listener's `executeScript` could beat.
- **A click with a popup** is then the shell opening `<webview src={popup}>` in a panel under the icon. A browser-initiated navigation to `chrome-extension://` is allowed, and the page gets the full extension API because of its origin, not because of the view it is in. The shell closes the panel on an outside press or Escape. When the popup calls `window.close()`, the new `WebViewGuestClient.CloseRequested()` makes the element dispatch `domicile-close`.

The SDK side is the `window.domicile` client in `packages/chrome-sdk`, plus
`packages/shell-manganese/src/extensions/` for the tray and the popup panel.

### Tabs: every `<webview>`, in one window

| Chrome's concept | On a desk |
|---|---|
| Tab | A `WebViewGuest`, view type `kTabContents` as Chrome's tabs (`runtime.getContexts` NOTREACHEDs on none). It gets `SessionTabHelper` (the tab id, also what `declarativeNetRequest`'s `tabIds` and `webRequest` read) and `extensions::TabHelper` (`activeTab` grants, `scripting.executeScript`) when it is created. |
| Window | One `DomicileWindowController : extensions::WindowController`, registered in `WindowControllerList`. Its tabs are the live guests, in creation order. |
| Active tab | The guest whose element last took focus: the shell already moves focus with `view.focus()`. The browser has no notification for an inner `WebContents` gaining focus, so the element says so (`WebViewGuest.Focused`). An extension page never takes it: a popup is in a `<webview>` too, and would name itself. |

Lookups walk Chrome's browser windows. Four get one hook call each into
`chrome/browser/extensions/domicile_desk_hooks.h` (patch 0057, 27 lines):

| Lookup | The desk's answer |
|---|---|
| `ExtensionTabUtil::GetTabById` | the guest, the desk's controller, its index |
| `ExtensionTabUtil::CreateTabObject` | its index and `active`, which no tab strip gives |
| `ExtensionTabUtil::ForEachTab` | every guest too |
| `ChromeExtensionFunctionDetails::GetCurrentWindowController` | the desk: the shell's window is not one, and its active tab is the shell |

`tabs.query` is not patched: it and every mutation below are the desk's own
`ExtensionFunction`s, registered over Chrome's by name
(`ExtensionFunctionRegistry::Register` replaces an entry). Tab events
(`onCreated`, `onUpdated`, `onRemoved`, `onActivated`, `onZoomChange`) come
from the guests' lifecycle, broadcast through the profile's `EventRouter` exactly as
`TabsEventRouter` builds them; its dispatch is private, and its tab entries
`CHECK` a `TabInterface` a guest does not have.

Mutations go where the thing they change lives:

| Call | Goes to |
|---|---|
| `tabs.create({url})` | The shell, as `domicile-new-window` on the active tab's element. Answered with the next tab the desk gains |
| `tabs.update(id, {url})`, `{muted}` | The guest; the browser already holds its `WebContents` |
| `tabs.update(id, {active: true})`, `windows.update(id, {focused: true})` | The shell, as `domicile-focus-request` on that element |
| `tabs.remove(id)` | The shell, as `domicile-close` on that element. Answered once asked |
| `windows.get`, `getCurrent`, `getLastFocused`, `getAll` | The desk |
| `windows.create({type: "popup", url})` | A popup window; see below |
| `windows.remove(id)` | A popup window's tab, as `tabs.remove`. The desk's own window is refused |
| `tabs.move`, `group`, `ungroup`, `discard`, `duplicate`, `createSplit`, `unsplit`; `windows.create` of anything but a popup at one address; `tabs.update`'s `pinned`, `openerTabId`, `autoDiscardable`; `windows.update`'s bounds and state | An error: `not supported on a Domicile desk` |
| `tabs.setZoom`, `getZoom` | The guest: `WebViewGuest::ZoomTo`, the element's own zoom path, per site through `HostZoomMap`. The element hears it as `domicile-zoom-change`. `0` is the default; outside blink's browser range is refused |
| `tabs.getZoomSettings`, `setZoomSettings` | The desk: `automatic`, `per-origin`, the guest's one mode. Setting it is answered; any other is refused with the error above |

### Popup windows: the desk's, drawn by the shell

Bitwarden's sign-in is `windows.create({type: "popup", url, width, height})`,
closed with `windows.remove` once signed in. A popup window is a second
`DomicileWindowController`, type `popup`, owned by the desk's:

| Step | Where |
|---|---|
| `windows.create` makes the window, with no tab, and fires `windows.onCreated` | `DomicileWindowController::OpenPopup` |
| The shell is asked for its tab on the active tab's element: `domicile-popup-window` with `windowId`, `url`, `width`, `height` (0 for none) | `WebViewGuestClient.PopupWindowRequested`, `DomicilePopupWindowEvent` (patch 0078) |
| The shell opens `<webview popupwindow={windowId} src={url}>`; the element sends the id in `CreateGuest`, and its guest becomes the window's one tab | `HTMLWebViewElement::PopupWindow`, `AddToDesk` |
| `windows.create` answers with the window, populated | `WhenNextTab` |
| `windows.remove`, or the page's `window.close()`, is `domicile-close` on that element; the window goes with its tab, firing `windows.onRemoved` | `DeskWindowsRemoveFunction`, `PopupEmptied` |

What the window answers to:

| Call | A popup window |
|---|---|
| `windows.getCurrent`, `tabs.query({currentWindow})` | from its own page, itself; from no tab (a service worker), the desk's |
| `windows.getLastFocused`, `lastFocusedWindow` | itself once its tab took focus, until a desk tab does |
| `windows.getAll`, `tabs.query({windowType})` | listed with the desk's, filtered by type |
| `windows.update(id, {focused: true})` | `domicile-focus-request` on its element |

The desk's own window says `left: 0, top: 0`, the desktop's origin. Bitwarden
places its popup from the window it came from, and without them asks
`windows.create` for `NaN`.

## Key decisions

- **Config over a store UI.** A desk is declarative (home-manager writes it), and the Store's own flow needs a browser window behind it.
- **The compositor carries the list rather than the launcher adding `--load-extension`.** The launcher never reads the config, `--load-extension` is off by default in current Chromium (`DisableLoadExtensionCommandLineSwitch`), a switch cannot name a Web Store id, and it does not follow a reload.
- **The default profile, not a partition of its own.** It is the partition browser windows use (see `web_view_guest.h`, *NO GUEST SiteInstance*), so content scripts and network rules see the pages the user actually browses.
- **One window, not one per `<webview>`.** A shell's browser windows are what Chrome calls tabs, and extensions assume many tabs and one active tab per window.
- **Refuse what has no desktop meaning; never fake it.** A `tabs.move` that answers success and does nothing is a bug the extension cannot see.
- **A popup window is a window, not the tray's panel.** It has its own id, so `windows.remove` closes it and not the desk, and `tabs.query({windowType: "popup"})` finds it. The engine makes the window and the shell draws it; the attribute ties the two, because the browser cannot tell one `<webview>` from another.
- **Only a popup.** A `normal` window is the shell's browser window, which `tabs.create` already asks for; a tab moved in, an opener, a second address or incognito have no desk meaning. A size is passed on; a position is the shell's, as on a Wayland desktop in Chrome itself.
- **Passkeys come from an extension.** The browser draws no WebAuthn UI (patch `0048`), so a password manager's extension is where passkeys live: by a content script wrapping `navigator.credentials`, or by `chrome.webAuthenticationProxy`. `guard-webview-passkey-extension.sh` reads the second answering a page in a `<webview>`; its control, the same page refused with `PublicKeyCredential` present, is what the first needs.
- **Manifest V3 only.** Chromium at the pin no longer loads MV2, so uBlock Origin will not run and uBlock Origin Lite will. That is upstream's decision, not the desk's.

## Not in scope

- `chrome.contextMenus`: the desk turns the context menu off (#608).
- `chrome.commands`: a chord belongs to the shell. The route, if one is wanted, is `grabShortcut`.
- Install, permission and "extension added" bubbles: the config is the consent.

## Plan

Slice 1: extensions run, and show in a tray.

- [x] `guard-webview-content-script.sh`: an unpacked extension whose content script marks the page, loaded by hand (`--load-extension` plus the feature disabled), with the mark read from inside a `<webview>`. This proves the assumption everything else rests on, first.
- [x] `[extensions]` in `domicile-config`
- [x] `HostMessage::Extensions` in `domicile-protocol`, sent by the compositor with the handshake and on reload
- [x] `extension_installer` in the fork, and the control channel handing it the list. `guard-extension-installer.sh` loads the content-script fixture from the list alone.
- [x] `SessionTabHelper` and `extensions::TabHelper` on every `WebViewGuest`: `chrome/browser/domicile/domicile_tab_helpers.h`, handed to `BindWebViewGuestHost` by patch 0056 because the guest's target cannot depend on `//chrome`
- [x] `WebViewGuestClient.CloseRequested` and `domicile-close`
- [x] `ExtensionTray` mojo, `onextensions`, `activateExtension`. `guard-extension-tray.sh` reads a fixture's title, badge and popup off the event, opens the popup in a `<webview>`, reads its `runtime.getContexts` as a `TAB`, and hears its `window.close()` as `domicile-close`. Until slice 2, `action.onClicked` names the shell's own page as its tab
- [x] the chrome-sdk client: `DomicileClient.on("extensions")`, `activateExtension`, `WEBVIEW_CLOSE_EVENT`
- [x] manganese's tray and popup panel
- [x] *Extensions* in `docs/WRITING-A-SHELL.md`

Slice 2: tabs.

- [x] `DomicileWindowController` and the lookup hooks: patch 0057, `chrome/browser/domicile/domicile_desk.h`
- [x] tab events from `WebViewGuest`'s lifecycle
- [x] the mutations table, each to where it goes. `domicile-focus-request` is the element's new event, and manganese raises the window on it
- [x] manganese closes a browser window on `domicile-close`, as its Close button does
- [x] per-tab action state in `onextensions`, and `action.onClicked` naming the active tab
- [x] a guard: `guard-webview-tabs.sh`, a popup's `tabs.query({active: true, currentWindow: true})` names the focused `<webview>`; its control focuses the other one
- [x] tabs' zoom: the zoom four and `onZoomChange`, through the guest's own zoom. `guard-webview-tabs.sh`'s popup zooms the tab it named, and only that window's element hears it; its control zooms the other

Follow-ups:

- [x] `activeTab` granted on a tray click, popup or not: `ExtensionTray::Activate`. `guard-webview-active-tab.sh`: a fixture with `activeTab` and no host paints the focused `<webview>` with `scripting.executeScript` from its `onClicked`; its control does not click
- [x] popup windows: `windows.create({type: "popup"})`, `windows.remove`, and every window read across the desk's and its popups'. `guard-webview-popup-window.sh`: the fixture's window page finds itself a `popup` and removes itself; its control opens the same `<webview>` without `popupwindow`
- [x] manganese draws a popup window floating, at the size asked for
