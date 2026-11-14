// The stand-in for Electron's `ipcMain`: what the pages of the app's windows
// send through their preloads' `ipcRenderer`.

import { EventEmitter } from "node:events";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

/** The page a message came from: its window's `webContents`. */
export type IpcSender = {
  readonly id: number;
  readonly send: (channel: string, ...args: unknown[]) => void;
};

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/** What an `ipcMain.handle` handler gets first. */
export type IpcMainInvokeEvent = ReturnType<typeof invokeEvent>;

/** What an `ipcMain.on` listener gets first. */
export type IpcMainEvent = ReturnType<typeof messageEvent>;

/**
 * The `ipcMain` an Electron app sees, and what the host calls with each
 * page's `send` and `invoke`.
 */
export const createIpcMain = () => {
  const ipcMain = new IpcMain();
  return {
    invoke: (sender: IpcSender, channel: string, args: unknown[]) =>
      ipcMain.invoked(sender, channel, args),
    ipcMain,
    receive: (sender: IpcSender, channel: string, args: unknown[]) => {
      ipcMain.emit(channel, messageEvent(sender), ...args);
    },
  };
};

/**
 * Electron's `ipcMain`. A class because the app listens on it as an
 * `EventEmitter`.
 */
export class IpcMain extends EventEmitter {
  #handlers = new Map<string, Handler>();

  /** Answers each `ipcRenderer.invoke` on `channel`. One per channel. */
  readonly handle = (channel: string, handler: Handler) => {
    if (this.#handlers.has(channel)) {
      throw new Error(
        `Attempted to register a second handler for '${channel}'`,
      );
    }
    this.#handlers.set(channel, handler);
  };

  /** Answers the next `ipcRenderer.invoke` on `channel`, then stops. */
  readonly handleOnce = (channel: string, handler: Handler) => {
    this.handle(channel, (event, ...args) => {
      this.removeHandler(channel);
      return handler(event, ...args);
    });
  };

  readonly removeHandler = (channel: string) => {
    this.#handlers.delete(channel);
  };

  /**
   * The handler's answer to an invoke, or why there is none. A handler that
   * throws fails the page's promise with what it threw, as in Electron: the
   * app's bug is the page's to see.
   */
  readonly invoked = async (
    sender: IpcSender,
    channel: string,
    args: unknown[],
  ): Promise<Result<{ readonly result: unknown }, string>> => {
    const handler = this.#handlers.get(channel);
    if (handler === undefined) {
      return Err(`No handler registered for '${channel}'`);
    } else {
      try {
        return Ok({ result: await handler(invokeEvent(sender), ...args) });
      } catch (error) {
        return Err(String(error));
      }
    }
  };
}

const invokeEvent = (sender: IpcSender) => ({
  frameId: 0,
  processId: 0,
  sender,
});

const messageEvent = (sender: IpcSender) => ({
  ...invokeEvent(sender),
  /** Answers on the page's `ipcRenderer`. */
  reply: (channel: string, ...args: unknown[]) => {
    sender.send(channel, ...args);
  },
  /** For `sendSync`, which the engine doesn't carry yet. */
  returnValue: undefined as unknown,
});
