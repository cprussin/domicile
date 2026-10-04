# Browser windows owned by the engine

The engine owns browser windows and their pages. The shell only draws them,
with `<webview window="…">`. A window's live page (scroll position, form input,
media, history) survives `domicile load-shell`.

```ts
const id = domicile.openBrowserWindow("https://example.com");

const show = () => {
  root.replaceChildren(
    ...domicile.browserWindows.map(({ id }) =>
      Object.assign(document.createElement("webview"), { window: id }),
    ),
  );
};
show();
domicile.addEventListener("browserwindowschange", show);

domicile.closeBrowserWindow(id);
```

A `<webview src="…">` is unchanged: it is the shell's own page and is
destroyed with the shell. Manganese's extension popups use this kind.

## Problem

`load-shell` reloads the shell's page (`DomicileCommandSocket` →
`Reload(BYPASSING_CACHE)`). App windows survive because the compositor holds
them and `announce_open_apps` sends them to the new shell. Browser windows do
not survive:

- Manganese's `WindowState.windows` holds the list of browser windows.
- The shell's `WebContents` owns each guest `WebContents` through
  `AttachInnerWebContents`.
- The reload destroys the `<webview>` frames, so every guest is deleted. The new
  shell starts with no browser windows.

## Design

### The engine owns the guest

- `BrowserWindows` is profile user data, one per profile (like
  `DomicileWindowController`).
- It owns one `WebViewGuest` per window, holding its `WebContents` as a
  `unique_ptr`.
- The guest's delegate, observers, tab helpers and `SessionTabHelper` tab id
  last as long as the window, whether or not anything draws it.

```
openBrowserWindow(url) ─▶ BrowserWindows::Open ─▶ WebViewGuest (owns WebContents), navigated
<webview window=id>    ─▶ CreateGuest(..., window=id) ─▶ AttachUnownedInnerWebContents
element gone / reload  ─▶ DetachUnownedInnerWebContents; guest stays alive, unattached
closeBrowserWindow(id) ─▶ guest destroyed
```

- **Attach without transferring ownership.** At the pinned Chromium, content
  has `WebContents::AttachUnownedInnerWebContents` and
  `DetachUnownedInnerWebContents`. They sit behind
  `features::kAttachUnownedInnerWebContents` and a `PassKey` that only
  `guest_contents::GuestContentsHandle` can get. The fork enables the feature
  and makes `domicile::BrowserWindows` a friend of
  `UnownedInnerWebContentsClient`. This is the only content-side patch.
- **`//components/guest_contents` is not used.** It has its own mojom and
  renderer path; `<webview>` already has both.
- **Content detaches the guest.** When the hosting frame is destroyed (element
  removed or shell reloaded), `WebContentsTreeNode::OnFrameTreeNodeDestroyed`
  calls `DetachUnownedInnerWebContents` and keeps the guest. `BrowserWindows`
  observes the detach, marks the window unattached and drops the element's
  `WebViewGuestClient`.
- **An unattached guest behaves like a background tab.** It has no view, so it
  gets `WasHidden()` and Chrome's background throttling. Media keeps playing.

### The element binds to a window

`CreateGuest` gets an optional `string? window`:

| `window` | Result |
|---|---|
| unset | Shell-owned guest via `AttachInnerWebContents` (current behavior) |
| an unattached window | `AttachUnownedInnerWebContents`; the guest's `WebViewGuestClient` is rebound to this element |
| an attached window, or an unknown id | Refused; the element fires `domicile-guest-refused` with the reason |

- On rebind, the guest resets its `reported_*` fields to the element's initial
  values, then re-reports everything the element mirrors: url, security,
  history pair, loading, zoom and content size.
- `src` on a `<webview window>` is ignored.
- `popupwindow` moves from the element to `openBrowserWindow`'s options.

### The window list API

```webidl
partial interface DomicileHost {
  readonly attribute FrozenArray<DomicileBrowserWindow> browserWindows;
  attribute EventHandler onbrowserwindowschange;
  DOMString openBrowserWindow(USVString url);
  undefined closeBrowserWindow(DOMString id);
};

dictionary DomicileBrowserWindow {
  required DOMString id;      // "1", "2", … in open order; never reused in a run
  required USVString url;
  required DOMString title;
  long popupWindow;           // chrome.windows id, for an extension's popup window
  long width;                 // size a popup window requested, if any
  long height;
};
```

- This follows `window.domicile`'s shape (attribute plus a change event; see
  [WINDOW-DOMICILE.md](WINDOW-DOMICILE.md)).
- It can ship before that work. Until then, `DomicileClient` exposes it as
  `browserWindows` and `on("browser_windows")`.

### Programs open windows through the engine

When a program asks for a window, the engine opens it and then tells the shell
through `browserwindowschange`. The shell places it. This matches Wayland
clients, whose toplevels exist before the shell gets `app_appeared`.
`openBrowserWindow` is for the shell's own UI, such as a `+` button or a
launcher.

| Request | Current route | Planned route |
|---|---|---|
| `domicile open-url`, `BROWSER`, `xdg-open` | `UrlRegistry` → `openurl` → shell | `BrowserWindows::Open` |
| `target="_blank"`, `window.open`, `chrome.tabs.create` | `domicile-new-window` → shell | `BrowserWindows::Open` |
| `chrome.windows.create` popup | `domicile-popup-window` → shell | `BrowserWindows::Open`, with `popupWindow`, `width`, `height` |
| `window.close()`, `chrome.tabs.remove` on a window | `domicile-close` → shell | `BrowserWindows::Close` |

- `UrlRegistry`, `openurl`, `domicile-new-window` and `domicile-popup-window`
  are removed.
- `domicile-close` stays for `<webview src>`, since that page belongs to the
  shell (for example, an extension popup calling `window.close()`).
- A `<webview src>` still refuses new windows (`IsWebContentsCreationOverridden`).
- `chrome.tabs` is unchanged: every guest is a tab of the shell's Chrome window.

### Manganese

- `WindowState` keeps tiling, workspaces and the scratchpad, but no longer
  decides which browser windows exist. It folds in `browserWindows` the way it
  folds in `app_appeared` and `app_closed`: a new id opens a window, a missing
  id closes one.
- `BrowserOpened` calls `openBrowserWindow` and changes no state.
- A new id with `popupWindow` floats at `width` × `height`.
- `PopupWindowOpened`, `browsersOpened`, the `open_url` handler and
  `WindowRenamed` are removed. `title` comes from the engine.
- `BrowserWindow.tsx` renders `<webview window={id}>`.
- After a reload, every browser window is tiled on the current workspace, as
  app windows are.

## Key decisions

- **The engine keeps live pages, not a list of URLs.** A URL list would reload
  every page on each `load-shell`, losing in-page state and resending `POST`s.
- **`AttachUnownedInnerWebContents` over `GuestPageHolder`.** The MPArch path
  `CHECK`s `kGuestViewMPArch`, which is disabled at the pin (see
  `web_view_guest.h`). Upstream's detachable guest uses the unowned API.
- **Only `<webview window>` survives.** Shells draw pages that are not windows
  (popups, previews, sidebars). Those are destroyed with the shell.
- **The engine opens program windows; the shell places them.** The compositor
  does not ask the shell before mapping a Wayland toplevel, and browser windows
  work the same way. This also removes a race where `open-url` arrives during
  `load-shell`.
- **The shell owns layout across a reload.** Windows survive; their tiling does
  not. Layout is shell-specific, so a shell that wants it back stores it
  itself. Manganese keeps its tree in `sessionStorage`, keyed by window id.
- **A window that no shell draws stays alive.** It costs a renderer, but
  closing it would lose the page. `chrome.tabs` can still close it, and the
  next shell that draws windows shows it.
- **The engine assigns ids.** Manganese's `browser:<n>` counter restarts at 1
  after a reload and would collide with surviving windows.

## Plan

- [ ] fork: enable `kAttachUnownedInnerWebContents`; friend
      `domicile::BrowserWindows` in `UnownedInnerWebContentsClient`
- [ ] fork: `BrowserWindows`, owning guests; `WebViewGuest` split into the
      guest and its attachment, with `self_owned_` gone for windows
- [ ] fork: `CreateGuest(window)`, attach/detach, client rebind and
      re-report; `domicile-guest-refused`
- [ ] fork: `browserWindows`, `onbrowserwindowschange`, `openBrowserWindow`,
      `closeBrowserWindow` on `DomicileHost`
- [ ] fork: `open-url`, new windows, popup windows and closes go to
      `BrowserWindows`; remove `UrlRegistry`, `openurl` and the two element
      events
- [ ] guard: `guard-webview-survives-load-shell.sh`: open a window, type into
      a field, `load-shell`, and assert the same tab id and the field's value
- [ ] SDK: types, `DomicileClient` surface, `webview-element`'s `window`
- [ ] manganese: fold `browserWindows` into `WindowState`; open and close
      through the engine; `<webview window>`
- [ ] WRITING-A-SHELL.md: browser windows vs. a shell's own `<webview>`
