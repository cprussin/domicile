// A minimal headless stand-in for the chrome, used by the repo's e2e scripts.
// The real chrome is the Electron app in `apps/shell`; this connects to the
// same compositor socket, speaks the same newline-delimited JSON framing, and
// lets a script drive it.

import net from "node:net";

import { helloMessage } from "@domicile/chrome-sdk/chrome-message";
import {
  createFrameReader,
  withFrameDelimiter,
} from "@domicile/chrome-sdk/newline-frames";
import type { HostMessage } from "@domicile/chrome-sdk/protocol";
import { parseHostMessage } from "@domicile/chrome-sdk/protocol";

export type ChromeSocket = {
  send: (message: unknown) => void;
  close: () => void;
};

export type ChromeSocketOptions = {
  /** Called for each frame the host pushes, as the raw JSON text. */
  onFrame?: (text: string) => void;
  /** Called for each frame that decodes to a message this build understands. */
  onMessage?: (message: HostMessage) => void;
};

/**
 * Connect to the compositor's chrome socket and complete the handshake.
 *
 * Socket errors are dropped deliberately: these harnesses are killed by the
 * scripts that spawn them, so a teardown-time ECONNRESET is the expected end of
 * a successful run rather than a failure worth reporting. Without a listener
 * node would raise it as an uncaught exception instead.
 */
export const connectChromeSocket = (
  socketPath: string,
  { onFrame, onMessage }: ChromeSocketOptions = {},
): ChromeSocket => {
  const socket = new net.Socket();

  const send = (message: unknown): void => {
    socket.write(withFrameDelimiter(JSON.stringify(message)));
  };

  const readFrames = createFrameReader();
  socket.on("data", (chunk: Buffer) => {
    for (const frame of readFrames(chunk.toString())) {
      onFrame?.(frame);
      const message = parseHostMessage(frame);
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
