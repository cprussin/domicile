import { describe, expect, it } from "bun:test";

import type { Result } from "@cprussin/option-result";

import type { IpcSender } from "./ipc-main";
import { createIpcMain } from "./ipc-main";
import { MessageChannelMain } from "./message-port-main";

const page = () => {
  const sent: [string, unknown[]][] = [];
  const sender: IpcSender = {
    id: 3,
    send: (channel, ...args) => sent.push([channel, args]),
  };
  return { sender, sent };
};

type Outcome = { readonly error: string } | { readonly value: unknown };

/** A result as plain data, to compare. */
const outcome = (
  answer: Result<{ readonly result: unknown }, string>,
): Outcome =>
  answer.match<Outcome>({
    Err: (error) => ({ error }),
    Ok: ({ result }) => ({ value: result }),
  });

describe(createIpcMain, () => {
  it("gives a page's send to the channel's listeners, with its page", () => {
    const { ipcMain, receive } = createIpcMain();
    const { sender } = page();
    const heard: unknown[] = [];
    ipcMain.on("save", (event: { sender: IpcSender }, ...args: unknown[]) =>
      heard.push(event.sender.id, ...args),
    );

    receive(sender, "save", [1, "a"]);

    expect(heard).toEqual([3, 1, "a"]);
  });

  it("replies on the page's ipcRenderer", () => {
    const { ipcMain, receive } = createIpcMain();
    const { sender, sent } = page();
    ipcMain.on("ping", (event: { reply: (c: string, v: unknown) => void }) =>
      event.reply("pong", 1),
    );

    receive(sender, "ping", []);

    expect(sent).toEqual([["pong", [1]]]);
  });

  it("answers an invoke with its handler's result, awaited", async () => {
    const { invoke, ipcMain } = createIpcMain();
    ipcMain.handle("double", (_event, n) => Promise.resolve(Number(n) * 2));

    const answer = await invoke(page().sender, "double", [2]);

    expect(outcome(answer)).toEqual({ value: 4 });
  });

  it("fails an invoke whose handler throws, with what it threw", async () => {
    const { invoke, ipcMain } = createIpcMain();
    ipcMain.handle("fail", () => {
      throw new Error("no");
    });

    const answer = await invoke(page().sender, "fail", []);

    expect(outcome(answer)).toEqual({ error: "Error: no" });
  });

  it("fails an invoke nobody handles, in Electron's words", async () => {
    const { invoke } = createIpcMain();

    const answer = await invoke(page().sender, "missing", []);

    expect(outcome(answer)).toEqual({
      error: "No handler registered for 'missing'",
    });
  });

  it("takes one handler a channel, and handleOnce answers once", async () => {
    const { invoke, ipcMain } = createIpcMain();
    ipcMain.handleOnce("once", () => "first");

    expect(() => ipcMain.handle("once", () => "second")).toThrow(
      "Attempted to register a second handler for 'once'",
    );
    expect(outcome(await invoke(page().sender, "once", []))).toEqual({
      value: "first",
    });
    expect((await invoke(page().sender, "once", [])).isErr()).toBe(true);
  });

  describe("sendSync", () => {
    it("answers with the returnValue a listener sets, even later", async () => {
      const { ipcMain, sendSync } = createIpcMain();
      ipcMain.on("now", (event: { returnValue: unknown }, n: number) =>
        queueMicrotask(() => {
          event.returnValue = n * 3;
        }),
      );

      const answer = await sendSync(page().sender, "now", [3]);

      expect(outcome(answer)).toEqual({ value: 9 });
    });

    it("fails one nobody listens for, as nothing could answer it", async () => {
      const { sendSync } = createIpcMain();

      const answer = await sendSync(page().sender, "missing", []);

      expect(outcome(answer)).toEqual({
        error: "Nothing listens for 'missing' to set its returnValue",
      });
    });
  });

  it("gives a page's postMessage to the listeners, with its ports", () => {
    const { ipcMain, post } = createIpcMain();
    const { port1 } = new MessageChannelMain();
    const heard: unknown[] = [];
    ipcMain.on(
      "port",
      (event: { ports: unknown[]; sender: IpcSender }, message: unknown) =>
        heard.push(event.sender.id, event.ports, message),
    );

    post(page().sender, "port", "hi", [port1]);

    expect(heard).toEqual([3, [port1], "hi"]);
  });
});
