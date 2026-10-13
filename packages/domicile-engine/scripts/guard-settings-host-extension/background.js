// Fixture for guard-settings-host.sh: connects to the Settings app's native
// messaging host as the app does, asks it to read, and logs what comes back.
//
// The guard serves this beside the Settings app's own manifest, so the worker
// runs with the app's id. The control drops the manifest's `key`, which gives
// it another id.
//
// Read from `globalThis` because the repo's linter does not know the
// extension global `chrome`.
const { runtime } = globalThis.chrome;

console.log("GUARD connecting");
const port = runtime.connectNative("domicile.settings");
port.onMessage.addListener((message) => {
  console.log(
    `GUARD reply id=${message.id} type=${message.type} config=${message.config?.text?.trim()}`,
  );
});
port.onDisconnect.addListener(() => {
  console.log(`GUARD disconnected ${runtime.lastError?.message}`);
});
port.postMessage({ id: 1, type: "read" });
