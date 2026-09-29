# Chrome extensions on a desk

A desk's config names Chrome extensions, and the engine installs them into the
profile its browser windows already use. Each extension's action shows in the
shell's tray and opens its popup in a `<webview>`. To `chrome.tabs`, every
`<webview>` is a tab, and the whole desktop is one `chrome.windows` window.

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
unpacked = ["/home/you/src/my-extension"]         # absolute: `~` is not expanded
```

| Step | Where |
|---|---|
| Parse `[extensions]`, keep-last-good on a bad edit | `domicile-config`, `ExtensionsConfig` |
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
  badgeColor: string;         // CSS color
  popup: string | undefined;  // chrome-extension://<id>/popup.html
  enabled: boolean;
}
```

- **`extensions` is the whole list, on every change.** Like `Displays`, a page that reloads is told again rather than having had to be listening. The source is `ExtensionRegistryObserver` plus `ExtensionActionDispatcher::Observer::OnExtensionActionUpdated`.
- **The icon is a data URL, not a `chrome-extension://` URL.** `action.setIcon({imageData})` sets an icon that has no URL.
- **Action state is per tab**, so the list reports it for the active tab. That needs slice 2; until then it reports the default state (tab `-1`).
- **A click with a popup** is the shell opening `<webview src={popup}>` in a panel under the icon. A browser-initiated navigation to `chrome-extension://` is allowed, and the page gets the full extension API because of its origin, not because of the view it is in. The shell closes the panel on blur. When the popup calls `window.close()`, the new `WebViewGuestClient.CloseRequested()` makes the element dispatch `domicile-close`.
- **A click without a popup** calls `activateExtension(id)`, which dispatches `action.onClicked` with the active tab.

The SDK side is the `window.domicile` client in `packages/chrome-sdk`, plus
`packages/shell-manganese/src/extensions/` for the tray and the popup panel.

### Tabs: every `<webview>`, in one window

| Chrome's concept | On a desk |
|---|---|
| Tab | A `WebViewGuest`. It gets `SessionTabHelper` (the tab id, also what `declarativeNetRequest`'s `tabIds` and `webRequest` read) and `extensions::TabHelper` (`activeTab` grants, `scripting.executeScript`) when it is created. |
| Window | One `DomicileWindowController : extensions::WindowController`, registered in `WindowControllerList`. Its tabs are the live guests, in creation order. |
| Active tab | The guest that last held focus: the shell already moves focus with `view.focus()`, and the browser sees it as the focused inner `WebContents`. |

Lookups (`ExtensionTabUtil::GetTabById`, `tabs.query`, `ForEachTab`) walk
Chrome's browser windows. Each one gets a single hook call that also consults
`DomicileWindowController`. This is the one edit to code Chromium owns, and the
price of each pin move. Tab events (`onCreated`, `onUpdated`, `onRemoved`,
`onActivated`) come from `WebViewGuest`'s lifecycle and go through
`TabsEventRouter`'s dispatch, not its `TabStripModel` observer.

Mutations go where the thing they change lives:

| Call | Goes to |
|---|---|
| `tabs.create({url})` | The shell, as a new-window request: the same path as `domicile-new-window` |
| `tabs.update(id, {url})` | The guest; the browser already holds its `WebContents` |
| `tabs.update(id, {active: true})`, `windows.update(id, {focused: true})` | The shell, as a focus request |
| `tabs.remove(id)` | The shell, as `domicile-close` on that element |
| `tabs.move`, `tabs.group`, `tabs.discard`, `windows.create`, `windows.remove` | An error: `not supported on a Domicile desk` |

## Key decisions

- **Config over a store UI.** A desk is declarative (home-manager writes it), and the Store's own flow needs a browser window behind it.
- **The compositor carries the list rather than the launcher adding `--load-extension`.** The launcher never reads the config, `--load-extension` is off by default in current Chromium (`DisableLoadExtensionCommandLineSwitch`), a switch cannot name a Web Store id, and it does not follow a reload.
- **The default profile, not a partition of its own.** It is the partition browser windows use (see `web_view_guest.h`, *NO GUEST SiteInstance*), so content scripts and network rules see the pages the user actually browses.
- **One window, not one per `<webview>`.** A shell's browser windows are what Chrome calls tabs, and extensions assume many tabs and one active tab per window.
- **Refuse what has no desktop meaning; never fake it.** A `tabs.move` that answers success and does nothing is a bug the extension cannot see.
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
- [ ] `SessionTabHelper` and `extensions::TabHelper` on every `WebViewGuest`
- [ ] `WebViewGuestClient.CloseRequested` and `domicile-close`
- [ ] `ExtensionTray` mojo, `onextensions`, `activateExtension`
- [ ] the chrome-sdk client, and manganese's tray and popup panel
- [ ] *Extensions* in `docs/WRITING-A-SHELL.md`

Slice 2: tabs.

- [ ] `DomicileWindowController` and the lookup hooks
- [ ] tab events from `WebViewGuest`'s lifecycle
- [ ] the mutations table, each to where it goes
- [ ] per-tab action state in `onextensions`
- [ ] a guard: a popup's `tabs.query({active: true, currentWindow: true})` names the focused `<webview>`
