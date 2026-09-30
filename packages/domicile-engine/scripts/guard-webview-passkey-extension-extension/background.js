// What guard-webview-passkey-extension.sh is about: a passkey extension
// answering a page's navigator.credentials.create(), in place of the browser's
// own WebAuthn UI, which this engine does not draw.
//
// The answer is an error whose message is `ANSWER`, because a credential the
// page would accept is a signed attestation this fixture has no reason to
// forge. The page paints it, and scripts/test-webview-passkey-extension-guard.sh
// holds the message here to the one the page looks for.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { webAuthenticationProxy } = globalThis.chrome;

const ANSWER = "domicile-guard-passkey-extension";

// A refusal is the finding when the guard fails, so it goes to the log.
const log = (error) => {
  console.error(`GUARD refused ${error.message}`);
};

webAuthenticationProxy.onCreateRequest.addListener(({ requestId }) => {
  webAuthenticationProxy
    .completeCreateRequest({
      error: { message: ANSWER, name: "NotAllowedError" },
      requestId,
    })
    .catch(log);
});

// Listening first: a request dispatched with no listener is dropped.
webAuthenticationProxy
  .attach()
  .then((refusal) => {
    console.log(`GUARD attached ${refusal ?? "ok"}`);
  })
  .catch(log);
