// Driven by scripts/e2e-spawn.sh: connect, ask the compositor to spawn a
// trivial client, and exit. Proves a chrome `spawn` message reaches the
// compositor's process launcher.

import { spawnMessage } from "@domicile/chrome-sdk/chrome-message";

import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

const RUN_MS = 500;

const chrome = connectChromeSocket(requireSocketPath(Bun.env));
chrome.send(spawnMessage(["true"]));

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, RUN_MS);
