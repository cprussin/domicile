// A headless chrome client for the e2e scripts. It connects to the
// compositor's chrome socket and speaks the same newline-delimited JSON as a
// real chrome.

import net from "node:net";

import { helloMessage } from "@domicile-desktop/sdk/chrome-message";
import { createHostStreamReader } from "@domicile-desktop/sdk/host-stream";
import { withFrameDelimiter } from "@domicile-desktop/sdk/newline-frames";
import type { HostMessageJson } from "@domicile-desktop/sdk/protocol";
import { parseHostMessage } from "@domicile-desktop/sdk/protocol";

export type ChromeSocket = {
  send: (message: unknown) => void;
  close: () => void;
};

export type ChromeSocketOptions = {
  /** Called for each frame the host pushes, as the raw JSON text. */
  onFrame?: (text: string) => void;
  /** Called for each frame that decodes to a message this build understands. */
  onMessage?: (message: HostMessageJson) => void;
};

/**
 * Connect to the compositor's chrome socket and complete the handshake.
 *
 * Socket errors are ignored. The calling scripts kill these harnesses, so an
 * ECONNRESET at teardown is normal. Without a listener, node would throw it.
 */
export const connectChromeSocket = (
  socketPath: string,
  { onFrame, onMessage }: ChromeSocketOptions = {},
): ChromeSocket => {
  const socket = new net.Socket();

  const send = (message: unknown): void => {
    socket.write(withFrameDelimiter(JSON.stringify(message)));
  };

  // Read as bytes: raw pixels follow an app frame's header, and a pixel byte
  // equal to a newline would split the frame. The pixels are dropped.
  const readHost = createHostStreamReader();
  socket.on("data", (chunk: Buffer) => {
    for (const item of readHost(chunk)) {
      onFrame?.(item.text);
      const message = parseHostMessage(item.text);
      if (message !== undefined) {
        onMessage?.(message);
      }
    }
  });
  socket.on("error", () => undefined);

  socket.connect(socketPath, () => {
    send(helloMessage());
  });

  return {
    close: () => {
      socket.destroy();
    },
    send,
  };
};

/** How long a harness stays connected, in milliseconds. */
export const listenWindowMs = (
  environment: Record<string, string | undefined>,
): number => {
  const configured = environment.DOMICILE_CHROME_LISTEN_MS;
  if (configured === undefined) {
    return DEFAULT_LISTEN_MS;
  }
  const window = Number(configured);
  if (!Number.isFinite(window) || window <= 0) {
    throw new Error(
      `DOMICILE_CHROME_LISTEN_MS must be a positive number of milliseconds, got: ${configured}`,
    );
  }
  return window;
};

/** Long enough for the message-plane checks, which drive an shm client. */
const DEFAULT_LISTEN_MS = 6000;

/**
 * The device pixel ratio the calling script wants reported, or `undefined`.
 *
 * A headless harness has no display, so it reports a ratio only when asked.
 */
export const devicePixelRatio = (
  environment: Record<string, string | undefined>,
): number | undefined => {
  const configured = environment.DOMICILE_CHROME_DPR;
  if (configured === undefined) {
    return undefined;
  }
  const ratio = Number(configured);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(
      `DOMICILE_CHROME_DPR must be a positive device pixel ratio, got: ${configured}`,
    );
  }
  return ratio;
};

/** The socket path the e2e scripts hand their harnesses. */
export const requireSocketPath = (
  environment: Record<string, string | undefined>,
): string => {
  const socketPath = environment.DOMICILE_CHROME_SOCK;
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error("DOMICILE_CHROME_SOCK must name the chrome socket");
  }
  return socketPath;
};
