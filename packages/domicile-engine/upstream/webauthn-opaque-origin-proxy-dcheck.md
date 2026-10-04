# Upstream bug report — ready to file, NOT filed

**Still unfiled**, for the reason `browser-plugin-embedder-null-guest-manager.md`
gives. Patch 0069 carries the fix; `scripts/guard-webview-passkey-extension.sh`
asks the question that reached it.

**Live:** a site's fraud-detection script (ThreatMetrix) asked from a sandboxed
frame, and the checked engine aborted and took the desktop with it.

Read at `cffcd2bf5a88`. **Possibly fixed upstream:** at `5fb9edc0544d` the
`DCHECK` is gone, with no opaque check in its place. Patch 0069 still answers
none for an opaque origin. Re-read at trunk before filing, or drop this.

---

**Title:** `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
from a sandboxed frame fails `DCHECK(!caller_origin.opaque())` in
`GetWebAuthnRequestProxyIfActive`

**Component:** Blink>WebAuthentication
**Type:** Bug

## What happens

`content/browser/webauth/authenticator_common_impl.cc`

```cpp
WebAuthenticationRequestProxy*
AuthenticatorCommonImpl::GetWebAuthnRequestProxyIfActive(
    const url::Origin& caller_origin) {
  DCHECK(!caller_origin.opaque());
```

`IsUvpaaAvailableInternal` calls it first thing, with the frame's origin and no
check, and so does `GetClientCapabilities` through it. Blink's
`isUserVerifyingPlatformAuthenticatorAvailable` checks nothing either.
`MakeCredential` and `GetCredential` validate the origin before they reach it.

## Repro

A DCHECK build; a secure page with:

```html
<iframe sandbox="allow-scripts" srcdoc="<script>
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
</script>"></iframe>
```

The browser process aborts. A release build answers `false`.

## Fix

An opaque origin cannot have a `webAuthenticationProxy` — an extension takes
requests per origin — so answer none rather than DCHECK:

```cpp
  if (caller_origin.opaque()) {
    return nullptr;
  }
```
