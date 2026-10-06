// The passkey extension for guard-webview-passkey-extension.sh. It answers a
// page's navigator.credentials.create(), since this engine draws no WebAuthn
// UI.
//
// It answers with an error whose message is `ANSWER`, which avoids forging a
// signed attestation. scripts/test-webview-passkey-extension-guard.sh checks it
// matches the message the page looks for.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { webAuthenticationProxy } = globalThis.chrome;

const ANSWER = "domicile-guard-passkey-extension";

// Logs a refusal, which explains a failed run.
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

// Attach after adding the listener: a request with no listener is dropped.
webAuthenticationProxy
  .attach()
  .then((refusal) => {
    console.log(`GUARD attached ${refusal ?? "ok"}`);
  })
  .catch(log);
