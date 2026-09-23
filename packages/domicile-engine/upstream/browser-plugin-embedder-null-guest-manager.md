# Upstream bug report — ready to file, NOT filed

**Still unfiled.** issues.chromium.org needs a Google account; neither the
machine that found this nor the session that reviewed it has one, so filing it
is a person's job. It is kept here rather than on a build machine so it is not
lost, and so that whoever files it does not have to re-derive it.

## Why this repo carries it

It killed a desktop. A `<webview>`'s page is a guest, so the shell's own
WebContents becomes a `BrowserPluginEmbedder` the moment one attaches, and from
then on a plain Escape pressed anywhere in the shell dereferenced null in the
browser process. Patch 0037 carries the fix; this is the report behind it, and
the reason the patch is four lines rather than a guest manager this fork has no
other use for.

**Live rather than latent**, which is the difference from
`setoverridechildpaintflags.md` next to it: the desktop went down, restarted,
and went down again on the next Escape. `scripts/guard-webview-escape.sh`
presses that key.

Everything below is written to be pasted into https://issues.chromium.org
(component: Internals>GuestView).

Read at `fa0ce55e9639`, fetched 2026-09-22, and byte-for-byte the same file at
`ecb0ced00f29`, the revision this fork pins now.
**Re-read `content/browser/browser_plugin/browser_plugin_embedder.cc` at trunk
before filing** — the file is small and quiet, but the body below quotes it
line for line.

---

**Title:** `BrowserPluginEmbedder::HandleKeyboardEvent` dereferences a null
`BrowserPluginGuestManager`, crashing the browser process on Escape

**Component:** Internals>GuestView
**Type:** Bug

## What happens

`content/browser/browser_plugin/browser_plugin_embedder.cc`

```cpp
bool BrowserPluginEmbedder::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  if ((event.windows_key_code != ui::VKEY_ESCAPE) ||
      (event.GetModifiers() & blink::WebInputEvent::kInputModifiers)) {
    return false;
  }

  GetBrowserPluginGuestManager()->ForEachGuest(
      web_contents_, [](WebContents* guest) { ... });

  return false;
}
```

`GetBrowserPluginGuestManager()` is
`web_contents_->GetBrowserContext()->GetGuestManager()`, and that can be null:
`ProfileImpl::GetGuestManager` returns `NULL` outright when
`ENABLE_GUEST_VIEW` is off, and returns
`guest_view::GuestViewManager::FromBrowserContext(this)` — which is null until
something creates one — when it is on.

Two of the four methods on this class already know that and check:

```cpp
void BrowserPluginEmbedder::CancelGuestDialogs() {
  if (!GetBrowserPluginGuestManager())
    return;
  ...
bool BrowserPluginEmbedder::AreAnyGuestsCurrentlyAudible() {
  if (!GetBrowserPluginGuestManager())
    return false;
```

`HandleKeyboardEvent` and `GetFullPageGuest` do not, so the class disagrees
with itself about its own invariant.

## Why it matters

It is a browser-process crash, reachable from a keystroke, in an embedder that
uses `BrowserPluginGuestDelegate` — which is `//content` public API — without
also installing a `BrowserPluginGuestManager`. Nothing in the API says the two
go together: `BrowserContext::GetGuestManager()`'s comment says only "Returns
the guest manager for this context", and the guards above say null is expected.

The path is short and needs no configuration beyond one attached guest:

1. anything attaches a guest, so `BrowserPluginGuest::Init` calls
   `owner_web_contents->CreateBrowserPluginEmbedderIfNecessary()`
2. the user presses Escape with no modifiers, anywhere in the embedder's page,
   and the renderer does not consume it
3. `WebContentsImpl::HandleKeyboardEvent` offers the unhandled key to
   `browser_plugin_embedder_` first
4. the Escape branch is taken and a null pointer is walked

The stack, from a real run:

```
Received signal 11 SEGV_MAPERR 000000000000
#4 content::BrowserPluginEmbedder::HandleKeyboardEvent()
#5 content::WebContentsImpl::HandleKeyboardEvent()
#6 input::InputRouterImpl::KeyboardEventHandled()
...
#34 content::BrowserMainLoop::RunMainMessageLoop()
```

`GetFullPageGuest()` is the same omission on the same object with a different
trigger: `WebContentsImpl::SaveFrameWithHeaders` calls it whenever a page is
saved from an embedder that has one, so a save rather than a keystroke.

Chrome itself is safe today only because the embedders that attach guests are
the ones that ship a `GuestViewManager` with them. An `ENABLE_GUEST_VIEW=false`
build that still uses the delegate is not, and neither is anything outside the
tree.

## How it was found

A compositor whose renderer is a forked Chromium, using
`BrowserPluginGuestDelegate` directly for its `<webview>` — deliberately
without `//components/guest_view`, because a guest SiteInstance requires a
non-default StoragePartition and a browser window in one is a browser window
where the user is logged out of everything. So a real embedder with real
guests, a browser context whose `GetGuestManager()` is null, and Escape.

## Suggested fix

Match the two methods on the same class that already check:

```cpp
bool BrowserPluginEmbedder::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  if ((event.windows_key_code != ui::VKEY_ESCAPE) ||
      (event.GetModifiers() & blink::WebInputEvent::kInputModifiers)) {
    return false;
  }

  if (!GetBrowserPluginGuestManager())
    return false;
  ...
```

```cpp
BrowserPluginGuest* BrowserPluginEmbedder::GetFullPageGuest() {
  if (!GetBrowserPluginGuestManager())
    return nullptr;
  ...
```

Both bodies are skippable rather than important: the loop rejects a pending
pointer-lock request on each guest, and a guest with no manager to enumerate is
a guest nothing could have found to lock.

The alternative reading is that `BrowserContext::GetGuestManager()` is
*required* to be non-null once a guest exists, in which case the two methods
that check are the ones that are wrong and the contract belongs in
`browser_context.h` and in `browser_plugin_guest_delegate.h`, where an embedder
would see it. Either answer is fine; the crash is that the file holds both.
