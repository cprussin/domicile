# Browser windows: a `<webview>` hosts a guest

`<webview>` keeps its frame owner and stops navigating it. The placeholder
frame it already creates becomes the attach point for a guest page, and the
guest's main frame is a main frame — so framing headers do not apply to it,
history crosses processes, and storage is not partitioned as a third party.

## Problem

Two defects with one cause: a browser window is a subframe, and a native
window is not.

| Symptom | Cause |
|---|---|
| A `<domicile-webview>` renders nothing on most sites | `X-Frame-Options` and CSP `frame-ancestors` apply to a frame owner |
| No window-management chord reaches the shell once a browser window is active | `BrowserWindow.tsx` calls `view.focus()`; a document dispatches keys only to its own focused frame |
| A floating browser window cannot be Alt-dragged or resized | both modifier sources bottom out in keys the chrome forwards, so both go deaf together |
| `wl_keyboard` focus strands on a hidden client | `AppWindow` calls `portal.focusApp()`; `BrowserWindow` tells the host nothing |

The first was known. [`ENGINE-FORK.md`](/docs/architecture/ENGINE-FORK.md)'s
patch 0007 states it: *"a site that refuses framing refuses to load — that is
the one thing Electron's guest-view `<webview>` bought that this does not."*

The second was reasoned into. `main.rs`'s `GrabShortcut` arm is logged and
nothing else, on the premise that *"the chrome … has already matched its own
chords before the compositor sees anything."* True for `<domicile-app>`, whose
pixels are a portal element in the chrome document. False for a `<webview>`,
which takes DOM focus away.

## Design

### A guest, not a frame

Chromium's ancestor throttle walks `GetParentOrOuterDocument()`, whose contract
is explicit: it *"will not cross a browsing session boundary (ie. it will not
escape a GuestView)."* A guest's main frame has no ancestor to check, so both
checks pass. This is Chromium's designed behaviour for guests, not a hole in
it — `ancestor_throttle.cc` says frame-ancestors is enforced *"not for
embedders or GuestViews."*

The element does not change shape. `AttachInnerWebContents(inner, rfh,
is_full_page)` wants a placeholder child frame in the outer WebContents, which
is what a frame owner already creates:

```
shell document  (domicile://shell/)
└── <webview>            HTMLFrameOwnerElement, reports kIframe   ← unchanged
    └── placeholder RFH  the frame the owner creates              ← attach here
        └── guest main frame   a main frame: no ancestors, own NavigationController
```

`BrowserPluginGuestDelegate` is four virtuals in `//content/public/browser`,
every one defaulted. The fork implements it and `WebContentsDelegate` on one
object, the way `GuestViewBase` does — so **no `//extensions` dependency, and
no `//components/guest_view`**.

### Who asks for the guest

The renderer cannot infer it: patch 0007 deliberately reports
`FrameOwnerElementType::kIframe` so the fork stays out of every switch on that
enum, which leaves the browser unable to tell a `<webview>` from an `<iframe>`.
So the element asks, over a mojo interface it owns, rather than the browser
guessing from the owner type. Keying on an explicit request is also what
extensions' `<webview>` does.

### Keys, once the guest exists

The fork owns the guest's `WebContentsDelegate`, so
`PreHandleKeyboardEvent` on it is the hook — it fires for the focused widget
whichever frame owns it. On a match: swallow the key, send `ShortcutPressed`.
The same hook reports `Modifiers(alt, ctrl, shift, meta)`.

Both legs already exist and are unused: `control_channel.cc:434` and `:444`
build them, `DomicileHost` dispatches `shortcut`, `Shell.tsx:162` handles it,
and `grabShortcut(ALT_TAB)` is already called. Nothing ever sends the wire
message. The shell needs no change for the keybindings.

## Key decisions

| Decision | Why |
|---|---|
| Guest over a carve-out in `AncestorThrottle` | A carve-out fixes framing only. A guest also fixes cross-process `goBack()`/`goForward()` — 0007's other stated gap — and third-party storage partitioning, which would otherwise turn a blank page into a logged-out one. |
| `AttachInnerWebContents` over `AttachGuestPage` | `AttachGuestPage` is `CHECK`-gated on `features::kGuestViewMPArch`, `FEATURE_DISABLED_BY_DEFAULT` at our pin. The legacy path is what shipping `<webview>` and PDF use today. Migrate when upstream flips the default; upstream must migrate `<webview>` itself, which gives us the reference. |
| The browser process matches the chord, not the compositor | The compositor is headless and sees only keys the chrome forwards. A focused guest forwards none. The browser process is the only layer above a focused frame. |
| `<webview>` keeps `FrameOwnerElementType::kIframe` | 0007's reason still holds; the guest request carries the signal instead. |

## Plan

- [x] a mojo interface for the element to request a guest, and its binder
- [x] the fork's guest delegate: `BrowserPluginGuestDelegate` + `WebContentsDelegate`
- [x] create and attach the guest; navigate it from `src`
- [ ] `PreHandleKeyboardEvent`: match a grabbed chord, send `ShortcutPressed`
- [ ] the same hook sends `Modifiers`
- [ ] `ControlChannel::GrabShortcut` records in the browser process instead of relaying
- [ ] decide the compositor's `grab_shortcut` message per [`DATA.md`](/docs/guidelines/DATA.md); delete the dead arm and its wrong comment
- [ ] `BrowserWindow.tsx` tells the host the keyboard left the app
- [ ] fix the two comments that state the false premise: `Shell.tsx` and `main.rs:2205-2212`
- [x] an engine guard that loads a framing-refusing site and asserts pixels
- [ ] an engine guard that drives a chord while a browser window holds focus

## Open questions

- **Does a guest's unhandled key still reach the embedder?**
  `GetParentOrOuterDocumentOrEmbedder`'s contract says it is the version used
  for *"input, compositing"*, which suggests yes. Not verified. It decides
  whether the shell's own non-grabbed keys still work over a browser window.
  Recommendation: verify in the guard before relying on it.
- **What `<webview>` loses by becoming a guest.** Guests are not a supported
  web platform surface; permissions, dialogs and new-window handling all route
  through the delegate and each needs an answer. Recommendation: implement the
  delegate's methods as refusals first, and open them one at a time against a
  guard.

## A unit test cannot prove any of this

There is no nested browsing context in jsdom, so `view.focus()` does not steal
keydown and `Alt+Tab` passes in `Shell.test.tsx` today. Both guards have to be
`packages/domicile-engine/scripts/guard-*.sh` or `scripts/e2e-*.sh` driving a
real engine. The `--app=` gate this repository shipped for a day was invisible
to every check for the same reason.
