# Browser windows in a shell

`<webview>` is a tag built into the engine. It shows a web page in its own
browsing context. A browser window in a shell is an address bar you draw over a
`<webview>`. Manganese's is
[`BrowserWindow.tsx`](/packages/shell-manganese/src/window-management/BrowserWindow.tsx).

Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md). Extensions are in
[SHELL-EXTENSIONS.md](SHELL-EXTENSIONS.md).

## The engine owns browser windows

The browser holds each browser window's page, so it outlives your document.
After `domicile load-shell`, the new shell gets every window with its scroll,
form input, history and playing media intact.

```ts
const drawn = new Map<string, HTMLElement>();

domicile.on("browser_windows", ({ windows }) => {
  for (const { id } of windows) {
    if (!drawn.has(id)) {
      const view = document.createElement("webview");
      view.setAttribute("window", id); // before append
      document.body.append(view);
      drawn.set(id, view);
    }
  }
});

plus.addEventListener("click", () => {
  domicile.openBrowserWindow("https://example.com");
});
```

- **`browser_windows`** sends the whole list when a window opens, closes,
  navigates or changes title. A window you have not drawn is new; a missing
  one was closed. Each has `id`, `url` and `title`. An extension's popup
  window also has `popupWindow`, `width` and `height`
  ([SHELL-EXTENSIONS.md](SHELL-EXTENSIONS.md)).
- **`openBrowserWindow(url)` and `closeBrowserWindow(id)`** are for your own
  UI. The result arrives in the next list. Other windows open without you
  ([New windows](#new-windows)).
- **Set `window` before the view enters the document.** The engine reads it
  once, when the view connects. A window shows in one view at a time: a second
  view naming it stays empty, so never remount the view drawing it.
- **A `<webview src="…">` with no `window`** is your own page, such as an
  extension's popup or a preview. It closes with your document.

## Basics

- `goBack`, `goForward`, `stop` and `reload` are element methods.
- `src` is reflected: setting the property or the attribute navigates. A view
  drawing a browser window does not send `src` on connect, since the page is
  already loaded.
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

- No Chrome shortcuts (Ctrl+R, Alt+Left, F11, Ctrl+W, …), no browser-drawn
  context menu, no swipe navigation.
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
  Ctrl+F and Ctrl+Shift+I.

Draw the context menu yourself:

- `domicile-context-menu`: a right click the page did not `preventDefault`.
  The event carries what was under the click: `linkUrl`, `srcUrl`,
  `mediaType`, `selectionText`, `isEditable`, the `can*` edit flags, and `x` /
  `y` relative to the view.
- `event.run(action)` does what only the browser can: `copy-link-address`,
  `save-link-as`, `copy-image`, `copy-media-address`, `save-media-as`, the
  edit commands (`cut`, `paste`, …) and `inspect`. A save asks
  `domicile-file-chooser` where. See `WEBVIEW_CONTEXT_MENU_ACTIONS`.
- Back, reload and "open in new window" (`openBrowserWindow`) need no menu
  action.
- `view.inspect()` opens DevTools for the page in a new browser window. It
  arrives in the next `browser_windows`, like any other window.
- Manganese's `browser/page-menu.ts` builds Chrome's menu from the event.

Desktop chords from `bindKeys` still work while a guest has focus. They arrive
as a `shortcut` message. `domicile.grabShortcut` claims a chord that
`bindKeys` does not ([Keybindings](WRITING-A-SHELL.md#keybindings)).

## New windows

The browser opens a window without you for:

- a `target="_blank"` link, `window.open` or a middle click
- `domicile open-url <url>`, which `BROWSER` (`domicile-open-url`) and
  `xdg-open` run inside a desktop
- an extension's `tabs.create` or `windows.create`
- DevTools, from `view.inspect()` or a context menu's `inspect`

The window arrives in the next `browser_windows`. You decide where it goes.

The new window is a fresh navigation to that address:

- `window.open` returns `null` to the opener.
- The opener relationship and window name are lost.
- A form POSTed to a new target arrives as a GET of its action.

A plain link (`target="_blank"` or middle click) loses nothing.

## Close requests

`window.close()` in a browser window's page, or an extension's
`chrome.tabs.remove`, closes the window. It leaves the next `browser_windows`.
`window.close()` works only when the page's history has a single entry.

In a view of your own (a `<webview src>` with no `window`), the element fires
`domicile-close` and nothing closes until you remove it:

```ts
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";

popupView.addEventListener(WEBVIEW_CLOSE_EVENT, () => {
  popupView.remove();
});
```

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
