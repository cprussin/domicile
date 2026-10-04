# Browser windows in a shell

`<webview src="…">` is a tag built into the engine. It shows a web page in its
own browsing context. A browser window in a shell is an address bar you draw
over a `<webview>`. Manganese's is
[`BrowserWindow.tsx`](/packages/shell-manganese/src/window-management/BrowserWindow.tsx).

Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md). Extensions are in
[SHELL-EXTENSIONS.md](SHELL-EXTENSIONS.md).

```ts
const view = document.createElement("webview");
view.src = "https://example.com";
document.body.append(view);

back.addEventListener("click", () => {
  view.goBack();
});
```

## Basics

- `goBack`, `goForward`, `stop` and `reload` are element methods.
- `src` is reflected: setting the property or the attribute navigates.
- Give it a size. Its intrinsic size is 300×150.
- `domicile://` addresses, and `blob:` URLs the shell created, show
  `about:blank#blocked`. A guest on the shell's origin could control the
  compositor.
- The page is a guest with no parent frame, so sites that send
  `X-Frame-Options: DENY` or `frame-ancestors 'none'` still load.
- Pointer events, focus and keys inside the guest do not reach your page. The
  element reports what you need through properties and events.
- All `<webview>` events bubble, so one listener on your window frame covers
  them. In JSX, bind them with `addEventListener` on a ref.

## State: history, loading, address

Each piece of state is a property on the element. Its event carries no data
and only says to reread. Read once on mount too: a shell that mounts mid-load,
or a React shell whose listeners attach after the first commit, otherwise shows
stale state.

| Property | Event | Meaning |
|---|---|---|
| `canGoBack`, `canGoForward` | `domicile-history-change` | Whether back and forward would move |
| `loading` | `domicile-loading-change` | Whether the page is loading, as a browser's spinner shows. Same-document navigations (fragment, `pushState`) do not count |
| `url`, `security` | `domicile-page-change` | The address the page is at, and its connection security |
| `zoom` | `domicile-zoom-change` | Zoom factor; 1 is 100% |
| `favicon` | `domicile-favicon-change` | Icon URL, or `""` |
| `findMatches`, `findActiveMatch` | `domicile-find-change` | Find-in-page results |
| `contentWidth`, `contentHeight` | `domicile-content-size-change` | Page content size (for popups) |

```ts
import { WEBVIEW_HISTORY_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";

const readHistory = () => {
  back.disabled = !view.canGoBack;
  forward.disabled = !view.canGoForward;
};

readHistory();
view.addEventListener(WEBVIEW_HISTORY_CHANGE_EVENT, readHistory);
```

- **`url` vs `src`:** `src` is where you last sent the view. `url` is where
  the page is now, after links and redirects. Show `url` in the address bar.
- **`security`** is `neutral`, `secure`, `warning` or `dangerous`
  (`WEBVIEW_SECURITY_LEVELS`), from the same check as Chrome's padlock. `""`
  means unknown, not neutral. Always pair `security` with `url`, never with
  `src`, or the padlock can describe a different page.
- **`favicon`** is the best icon the page links (SVG first, then largest), as
  an absolute URL.

## Focus

A click inside the guest is invisible to your page, but its focus is not:

- The `<webview>` becomes `document.activeElement` and fires `focus` and
  `focusin`. Popover dismissal, focus traps and React `onFocus` work.
- `domicile-guest-focus` (`WEBVIEW_GUEST_FOCUS_EVENT`) also fires when the
  guest regains focus with your document. Use it to raise the window:

```ts
import { WEBVIEW_GUEST_FOCUS_EVENT } from "@domicile-desktop/sdk/webview-element";

frame.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, () => {
  raise(frame);
});
```

`frame.contains(document.activeElement)` tells you whether a browser window
(page or address bar) has focus.

## The keyboard

The compositor does not know about browser windows, so the shell moves
keyboard focus to and from them:

- **Take it:** call `focusChrome(domicile)` (from
  `@domicile-desktop/sdk/focus-chrome`) when a browser window becomes active.
  Otherwise the last focused client keeps receiving keys. See
  [Taking the keyboard](WRITING-A-SHELL.md#taking-the-keyboard-for-your-own-ui).
- **Give it back:** blur the focused element in the browser window when the
  user switches away. While a guest page has focus, keys never reach your
  document, so `focusApp` cannot forward them and other windows get no keys.
- **Keep the caret:** do not focus the page if the window already has focus.
  The click that activated the window may have been in the address bar.

The guest has no built-in browser behavior:

- No Chrome shortcuts (Ctrl+R, Alt+Left, F11, Ctrl+W, …), no context menu (the
  page's `contextmenu` event is all you get), no swipe navigation.
- No password saving, autofill, translation or built-in passkeys. Passkeys
  come from a password manager extension.

Bind browser keys yourself:

- `domicile-guest-keydown`: a `KeyboardEvent` for each chord (Ctrl, Alt or
  Meta held) the page did not `preventDefault`. Plain keys never arrive.
- `domicile-zoom-in-request` / `domicile-zoom-out-request`: Ctrl+wheel. They
  zoom nothing. Call `view.setZoom(factor)` (0.25 to 5). Zoom is per host, as
  in Chrome.
- `view.find(text, backward)` searches; the same text again goes to the next
  match. `view.stopFinding()` ends it. A navigation ends it too. Matches are
  counted across all frames.
- Manganese's `BrowserWindow.tsx` binds Chrome's default keys, including
  Ctrl+F.

Desktop chords from `bindKeys` still work while a guest has focus. They arrive
as a `shortcut` message. `domicile.grabShortcut` claims a chord that
`bindKeys` does not ([Keybindings](WRITING-A-SHELL.md#keybindings)).

## New windows

A `target="_blank"` link, `window.open`, or a middle click fires
`domicile-new-window` with `event.url`. The browser opens no window. Open one
yourself, or the link does nothing.

```ts
import { WEBVIEW_NEW_WINDOW_EVENT } from "@domicile-desktop/sdk/webview-element";

frame.addEventListener(WEBVIEW_NEW_WINDOW_EVENT, (event) => {
  openBrowserWindow(event.url);
});
```

The new window is a fresh navigation to that address:

- `window.open` returns `null` to the opener.
- The opener relationship and window name are lost.
- A form POSTed to a new target arrives as a GET of its action.

A plain link (`target="_blank"` or middle click) loses nothing.

Apps outside the browser open links with `domicile open-url <url>` (the
desktop's `BROWSER`, `domicile-open-url`, runs it). It sends `open_url` to the
shell:

```ts
domicile.on("open_url", ({ url }) => {
  openBrowserWindow(url);
});
```

## Close requests

`window.close()` in the page, or an extension's `chrome.tabs.remove`, fires
`domicile-close`. Nothing closes until you remove the window:

```ts
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";

frame.addEventListener(WEBVIEW_CLOSE_EVENT, () => {
  closeBrowserWindow(frame);
});
```

`window.close()` fires it only when the page's history has a single entry.

## File pickers

`<input type="file">`, downloads, `showSaveFilePicker()` and the PDF viewer's
save all fire `domicile-file-chooser`. The browser shows no dialog; you draw
the picker.

```ts
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile-desktop/sdk/webview-element";

frame.addEventListener(WEBVIEW_FILE_CHOOSER_EVENT, (event) => {
  event.preventDefault(); // claim it
  showPicker(event.mode, event.accept, event.suggestedName).then(
    (paths) => event.choose(paths),
    () => event.cancel(),
  );
});
```

- **`preventDefault()`:** claims it. Unclaimed choosers are canceled when
  dispatch returns.
- **`event.home`** is the absolute home directory.
- **`event.list(path)`** lists a directory while the chooser is open.
  Directories end in `/`. It rejects for an unreadable path.
- **Paths** are absolute or relative to home (`""` is home). `..` throws a
  `TypeError`.
- **`mode`** is `open`, `open-multiple`, `open-folder` or `save`. `accept`
  lists extensions without the dot (empty means any). `suggestedName` is for
  saves.
- **Downloads:** every download asks, in `save` mode. Canceling saves
  nothing.

## Not supported yet

- `alert`, `confirm` and `prompt` show nothing and return at once.
- Permission requests (camera, microphone, location, …) are denied.
  Notifications are the exception: pages may show them
  ([NOTIFICATIONS.md](/docs/architecture/NOTIFICATIONS.md)).

[ROADMAP.md](/ROADMAP.md) tracks both.
