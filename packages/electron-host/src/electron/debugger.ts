// Electron's `webContents.debugger`: the app's own DevTools client on its
// page, which the engine attaches beside the host members' (method
// `devtools` with `debugger`). See "Page calls" in
// docs/architecture/ELECTRON-APPS.md.

import { EventEmitter } from "node:events";
import { Priority, say } from "../journal";
import type { PageCaller } from "./page-control";

/** The protocol versions Chromium's DevTools speaks. */
const PROTOCOL_VERSIONS = new Set(["", "1.0", "1.1", "1.2", "1.3"]);

/** Why the debugger detached, in Electron's words. */
const TARGET_CLOSED = "target closed";

/** Electron's `Debugger`. */
export class Debugger extends EventEmitter {
  /** The engine attaching the client, while it is attached. */
  #attaching: Promise<unknown> | undefined;

  constructor(readonly call: PageCaller["call"]) {
    super();
  }

  readonly isAttached = () => this.#attaching !== undefined;

  /** Attaches the client; its commands wait for the engine to. */
  readonly attach = (protocolVersion = "") => {
    if (this.#attaching !== undefined) {
      throw new Error("Another debugger is already attached");
    } else if (PROTOCOL_VERSIONS.has(protocolVersion)) {
      const attaching = this.call({ method: "debugger_attach" });
      this.#attaching = attaching;
      attaching.catch((error: unknown) => {
        say(
          Priority.Error,
          `electron-host: the debugger couldn't attach: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (this.#attaching === attaching) {
          this.detached(TARGET_CLOSED);
        }
      });
    } else {
      throw new Error("Requested protocol version is not supported");
    }
  };

  /** Detaches the client, which says `detach` as Electron's does. */
  readonly detach = () => {
    if (this.#attaching !== undefined) {
      this.call({ method: "debugger_detach" }).catch((error: unknown) => {
        say(
          Priority.Error,
          `electron-host: the debugger couldn't detach: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      this.detached(TARGET_CLOSED);
    }
  };

  /** Sends `method` to the page, or to the target of `sessionId`. */
  readonly sendCommand = async (
    method: string,
    commandParams: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ) => {
    const attaching = this.#attaching;
    if (attaching === undefined) {
      throw new Error("No target available");
    } else {
      await attaching;
      return this.call({
        debugger: true,
        devtools_method: method,
        method: "devtools",
        params: commandParams,
        ...(sessionId === undefined || sessionId === ""
          ? {}
          : { session_id: sessionId }),
      });
    }
  };

  /** Takes an event of the client, from the page or an attached target. */
  readonly receive = (
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
  ) => {
    if (this.#attaching !== undefined) {
      this.emit("message", {}, method, params, sessionId ?? "");
    }
  };

  /** The client went, with its page or for `reason`. */
  readonly detached = (reason: string) => {
    if (this.#attaching !== undefined) {
      this.#attaching = undefined;
      this.emit("detach", {}, reason);
    }
  };
}
