# Upstream bug: WebAuthn proxy DCHECK on opaque origin (unfiled)

Not filed: issues.chromium.org needs a Google account, so a person must file it.

- **Impact here:** a site's fraud-detection script (ThreatMetrix) called this
  from a sandboxed frame. The DCHECK engine aborted and the desktop went down.
- **Our fix:** patch 0069.
- **Guard:** `scripts/guard-webview-passkey-extension.sh`.
- **Status:** read at `cffcd2bf5a88`. At `5fb9edc0544d` the `DCHECK` is gone,
  with no opaque check in its place. Re-read at trunk before filing; drop this
  if it no longer applies.

The report below is ready to paste.

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

- `IsUvpaaAvailableInternal` calls it first, with the frame's origin and no
  check. `GetClientCapabilities` reaches it the same way.
- Blink's `isUserVerifyingPlatformAuthenticatorAvailable` does not check the
  origin either.
- `MakeCredential` and `GetCredential` validate the origin before calling it.

## Repro

In a DCHECK build, load a secure page with:

```html
<iframe sandbox="allow-scripts" srcdoc="<script>
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
</script>"></iframe>
```

The browser process aborts. A release build returns `false`.

## Fix

An extension registers a `webAuthenticationProxy` per origin, so an opaque
origin cannot have one. Return none:

```cpp
  if (caller_origin.opaque()) {
    return nullptr;
  }
```
