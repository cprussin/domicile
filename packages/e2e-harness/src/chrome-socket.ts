// A minimal headless stand-in for the chrome, used by the repo's e2e scripts.
// The real chrome is the Electron app in `apps/shell`; this connects to the
// same compositor socket, speaks the same newline-delimited JSON framing, and
// lets a script drive it.

import net from "node:net";

import { helloMessage } from "@domicile/chrome-sdk/chrome-message";
import {
  takeFrames,
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

  let buffered = "";
  socket.on("data", (chunk: Buffer) => {
    const { frames, rest } = takeFrames(buffered + chunk.toString());
    buffered = rest;
    for (const frame of frames) {
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
