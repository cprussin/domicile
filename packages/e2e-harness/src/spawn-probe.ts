// Driven by scripts/e2e-spawn.sh: connect, ask the compositor to spawn a
// client that reports the display it was handed, and exit. Proves both that a
// chrome `spawn` message reaches the compositor's process launcher and that
// what it launches is aimed at *Domicile* — a client that inherited the
// compositor's own WAYLAND_DISPLAY opens on the host desktop instead, which
// looks like a compositor that is not compositing.

import { spawnMessage } from "@domicile/chrome-sdk/chrome-message";

import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

const RUN_MS = 500;

const socketPath = requireSocketPath(Bun.env);
// Beside the socket rather than at a path of its own: the runtime directory is
// the one place both this and the script already agree on, and an env var for
// it would have to be declared to turbo before biome would allow it.
const reportTo = `${socketPath}.display`;

const chrome = connectChromeSocket(socketPath);
// `sh` rather than a bun script because the point is what the *child process*
// inherited, and only a child sees that.
chrome.send(
  spawnMessage([
    "sh",
    "-c",
    `printf %s "\${WAYLAND_DISPLAY-}" > "${reportTo}"`,
  ]),
);

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, RUN_MS);
