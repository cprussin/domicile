# Upstream bug: `BrowserPluginEmbedder` null guest manager crash (unfiled)

Not filed: issues.chromium.org needs a Google account, so a person must file it.

- **Impact here:** attaching a `<webview>` makes the shell's WebContents a
  `BrowserPluginEmbedder`. After that, pressing Escape anywhere in the shell
  crashed the browser process, and the desktop went down on every Escape.
- **Our fix:** patch 0037, a null check. We do not install a guest manager
  because nothing else needs one.
- **Guard:** `scripts/guard-webview-escape.sh` presses Escape.
- **Status:** read at `fa0ce55e9639` (2026-09-22); unchanged at
  `5fb9edc0544d`. Re-read
  `content/browser/browser_plugin/browser_plugin_embedder.cc` at trunk before
  filing.

The report below is ready to paste.

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

`GetBrowserPluginGuestManager()` returns
`web_contents_->GetBrowserContext()->GetGuestManager()`, which can be null:

- With `ENABLE_GUEST_VIEW` off, `ProfileImpl::GetGuestManager` returns `NULL`.
- With it on, it returns `guest_view::GuestViewManager::FromBrowserContext(this)`,
  which is null until something creates one.

Two of the class's four methods check for null:

```cpp
void BrowserPluginEmbedder::CancelGuestDialogs() {
  if (!GetBrowserPluginGuestManager())
    return;
  ...
bool BrowserPluginEmbedder::AreAnyGuestsCurrentlyAudible() {
  if (!GetBrowserPluginGuestManager())
    return false;
```

`HandleKeyboardEvent` and `GetFullPageGuest` do not.

## Why it matters

Any embedder that uses `BrowserPluginGuestDelegate` (public `//content` API)
without a `BrowserPluginGuestManager` can crash the browser process with one
keystroke. Nothing in the API says the two are required together.
`BrowserContext::GetGuestManager()` is documented only as "Returns the guest
manager for this context", and the existing null checks imply null is allowed.

Steps:

1. A guest attaches. `BrowserPluginGuest::Init` calls
   `owner_web_contents->CreateBrowserPluginEmbedderIfNecessary()`.
2. The user presses Escape with no modifiers in the embedder's page, and the
   renderer does not consume it.
3. `WebContentsImpl::HandleKeyboardEvent` passes the key to
   `browser_plugin_embedder_`.
4. The Escape branch dereferences null.

Stack from a real run:

```
Received signal 11 SEGV_MAPERR 000000000000
#4 content::BrowserPluginEmbedder::HandleKeyboardEvent()
#5 content::WebContentsImpl::HandleKeyboardEvent()
#6 input::InputRouterImpl::KeyboardEventHandled()
...
#34 content::BrowserMainLoop::RunMainMessageLoop()
```

`GetFullPageGuest()` has the same bug.
`WebContentsImpl::SaveFrameWithHeaders` calls it when a page is saved from an
embedder.

Chrome is safe because its embedders that attach guests also create a
`GuestViewManager`. An `ENABLE_GUEST_VIEW=false` build that uses the delegate,
or an embedder outside the tree, is not.

## How it was found

Our compositor runs a forked Chromium and implements `<webview>` with
`BrowserPluginGuestDelegate` directly, without `//components/guest_view`. A
guest SiteInstance from `guest_view` requires a non-default StoragePartition,
which would log the user out of every site in the browser window. So the
browser context has real guests and a null `GetGuestManager()`.

## Suggested fix

Add the same check the other two methods use:

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

Skipping both bodies is safe. The loop rejects pending pointer-lock requests
on each guest, and with no manager no guest could have requested a lock.

Alternatively, if `GetGuestManager()` must be non-null once a guest exists,
the two existing checks are wrong. Document that contract in
`browser_context.h` and `browser_plugin_guest_delegate.h`. Either way, the
file should pick one.
