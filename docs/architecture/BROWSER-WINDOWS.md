# Browser windows are the engine's

The engine owns the desk's browser windows. It opens one when a program asks
(`open-url`, a link, an extension) or the shell does, and the shell draws it
with `<webview window="…">`; the page inside belongs to the engine. So `domicile load-shell` keeps every browser window open with its live
page: scroll, form input, media, history and all.

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

A `<webview src="…">` stays what it is today: the shell's own page, gone with
the shell. Manganese's extension popups are this kind.

## Problem

`load-shell` reloads the shell's page (`DomicileCommandSocket` →
`Reload(BYPASSING_CACHE)`). App windows survive because the compositor holds
them and `announce_open_apps` re-states them. Browser windows do not:

| Layer | Who holds it today |
|---|---|
| which browser windows exist | manganese's `WindowState.windows` |
| the page | the guest `WebContents`, owned by the shell's `WebContents` through `AttachInnerWebContents` |

The reload destroys the `<webview>` frames, so the outer `WebContents` deletes
every guest, and the new shell starts with no browser windows.

## Design

### The engine owns the guest

`BrowserWindows`, one per profile and held as profile user data (like the
desk's `DomicileWindowController`), owns one `WebViewGuest` per window, with
its `WebContents` as a `unique_ptr`. The guest's delegate, observers, tab
helpers and `SessionTabHelper` tab id stay with the window for its whole life,
whether or not anything is drawing it.

```
openBrowserWindow(url) ─▶ BrowserWindows::Open ─▶ WebViewGuest (owns WebContents), navigated
<webview window=id>    ─▶ CreateGuest(..., window=id) ─▶ AttachUnownedInnerWebContents
element gone / reload  ─▶ DetachUnownedInnerWebContents; guest lives on, unattached
closeBrowserWindow(id) ─▶ guest destroyed
```

**Attach without giving ownership away.** At the pin, content has
`WebContents::AttachUnownedInnerWebContents` and
`DetachUnownedInnerWebContents`, behind `features::kAttachUnownedInnerWebContents`
and a `PassKey` that only `guest_contents::GuestContentsHandle` can get. The
fork enables the feature and adds `domicile::BrowserWindows` as a friend of
`UnownedInnerWebContentsClient`. That is the whole content-side patch.
`//components/guest_contents` itself is not used: it brings its own mojom and
renderer path, and the `<webview>` element already has both.

**Content detaches it.** When the frame hosting an unowned guest is destroyed
(the element removed, or the shell reloaded),
`WebContentsTreeNode::OnFrameTreeNodeDestroyed` calls
`DetachUnownedInnerWebContents` and leaves the guest alive. `BrowserWindows`
watches for the detach so it can mark the window unattached and drop the
element's `WebViewGuestClient`.

**An unattached guest is a background tab.** It has no view, so it gets
`WasHidden()`, and Chrome's own background throttling applies. Media keeps
playing, as it does in a background tab.

### The element binds to a window

`CreateGuest` gains `string? window`:

| `CreateGuest` | Result |
|---|---|
| `window` unset | today's guest, owned by the shell: `AttachInnerWebContents` |
| `window` names an unattached window | `AttachUnownedInnerWebContents`, and the guest's `WebViewGuestClient` is rebound to this element |
| `window` names an attached window, or no window | refused; the element fires `domicile-guest-refused` with the reason |

On rebind, the guest re-reports everything the element mirrors: url,
security, history pair, loading, zoom and content size. The `reported_*`
fields reset to the element's initial values first, so each change is sent
again.

`src` on a `<webview window>` is ignored: the window's page is already where it
is. `popupwindow` moves from the element to `openBrowserWindow`'s options.

### The window list is desk state

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
  long width;                 // the size a popup window asked for, if any
  long height;
};
```

This is `window.domicile`'s shape (attribute plus a bare change event; see
[WINDOW-DOMICILE.md](WINDOW-DOMICILE.md)). It ships before that work as it
stands. `DomicileClient` exposes it as `browserWindows` and `on("browser_windows")`
in the meantime.

### A program's window is opened by the engine

A program asking for a window gets one, the way a Wayland client's toplevel
exists before the shell hears `app_appeared`. The shell is told through
`browserwindowschange` and places it. `openBrowserWindow` is for the shell's
own UI: a `+` button, a launcher.

| Request | Today | Now |
|---|---|---|
| `domicile open-url`, `BROWSER`, `xdg-open` | `UrlRegistry` → `openurl` → shell | `BrowserWindows::Open` |
| `target="_blank"`, `window.open`, `chrome.tabs.create` | `domicile-new-window` → shell | `BrowserWindows::Open` |
| `chrome.windows.create` popup | `domicile-popup-window` → shell | `BrowserWindows::Open`, with `popupWindow`, `width`, `height` |
| `window.close()`, `chrome.tabs.remove` on a window | `domicile-close` → shell | `BrowserWindows::Close` |

`UrlRegistry`, `openurl`, `domicile-new-window` and `domicile-popup-window`
go. `domicile-close` stays for a `<webview src>`: that page is the shell's, so
closing it is too (an extension popup's `window.close()`). A `<webview src>` that is not a window still refuses new
windows (`IsWebContentsCreationOverridden`), as today. `chrome.tabs` is
unchanged: every guest is still a tab of the desk's window.

### Manganese

- `WindowState` keeps tiling, workspaces and the scratchpad. It no longer
  decides which browser windows exist. `browserWindows` is folded in like
  `app_appeared` and `app_closed`: a new id opens a window, a missing id
  closes one.
- `BrowserOpened` calls `openBrowserWindow` and changes no state. A new id
  with `popupWindow` floats at its `width` × `height`, as `PopupWindowOpened`
  does today. `PopupWindowOpened`, `browsersOpened` and the `open_url`
  handler go.
- `BrowserWindow.tsx` renders `<webview window={id}>`.
- `WindowRenamed` goes: `title` comes from the engine.

After a reload, every browser window comes back tiled on the current
workspace, as app windows do today.

## Key decisions

- **The engine owns the live page, not a list of addresses.** A list would
  reload every page on every `load-shell`, losing in-page state and repeating
  `POST`s. Ownership in the engine keeps the page and its process alive.
- **`AttachUnownedInnerWebContents` over `GuestPageHolder`.** The MPArch path
  `CHECK`s `kGuestViewMPArch`, which is disabled at the pin (see
  `web_view_guest.h`). The unowned API is what upstream's own detachable guest
  uses.
- **An explicit `window` attribute, not every `<webview>`.** A shell draws
  pages that are not windows: popups, previews, a sidebar. Those die with the
  shell. A page survives only if the shell said it is a window.
- **The engine opens a program's window; the shell places it.** A page, an
  extension or `open-url` asking for a window is a program asking, like a
  Wayland client mapping a toplevel, and the compositor never asks the shell
  first. This also removes the race of an `open-url` landing mid-`load-shell`.
- **Layout across a shell load is the shell's.** Windows survive, but where
  they were tiled does not. A shell that wants it back keeps its own layout
  (manganese: its tree in `sessionStorage`, keyed by the now-stable window id),
  because layout is shell-specific and a different shell can't read it.
- **A window no shell draws stays alive.** It costs a renderer, but closing it
  on a timer would lose the page this design exists to keep. `chrome.tabs`
  can still close it, and the next shell that draws windows shows it.
- **Ids are the engine's.** `browser:<n>` from manganese's counter would
  restart at 1 after a reload and collide with surviving windows.

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
      `BrowserWindows`; `UrlRegistry`, `openurl` and the two element events
      go
- [ ] guard: `guard-webview-survives-load-shell.sh`: open a window, type into
      a field, `load-shell`, and assert the same tab id and the field's value
- [ ] SDK: types, `DomicileClient` surface, `webview-element`'s `window`
- [ ] manganese: fold `browserWindows` into `WindowState`; open and close
      through the engine; `<webview window>`
- [ ] WRITING-A-SHELL.md: browser windows vs. a shell's own `<webview>`
