import { describe, expect, it } from "bun:test";
import { Debugger } from "./debugger";
import type { PageMethod } from "./page-control";

/** A debugger on a page that answers from `answer`. */
const fakeDebugger = (
  answer: (method: PageMethod) => Promise<unknown> = () =>
    Promise.resolve(null),
) => {
  const called: PageMethod[] = [];
  const debug = new Debugger((method) => {
    called.push(method);
    return answer(method);
  });
  const heard: unknown[][] = [];
  debug.on("message", (_event, ...args) => heard.push(["message", ...args]));
  debug.on("detach", (_event, ...args) => heard.push(["detach", ...args]));
  return { called, debug, heard };
};

describe(Debugger, () => {
  it("attaches, sends the app's commands on its own client, and detaches", async () => {
    const { called, debug, heard } = fakeDebugger((method) =>
      Promise.resolve(method.method === "devtools" ? { result: 2 } : null),
    );

    debug.attach("1.3");
    expect(debug.isAttached()).toBe(true);
    const answer = await debug.sendCommand("Runtime.evaluate", {
      expression: "1+1",
    });
    await debug.sendCommand("Target.getTargetInfo", undefined, "S");
    debug.detach();

    expect(answer).toEqual({ result: 2 });
    expect(debug.isAttached()).toBe(false);
    expect(called).toEqual([
      { method: "debugger_attach" },
      {
        debugger: true,
        devtools_method: "Runtime.evaluate",
        method: "devtools",
        params: { expression: "1+1" },
      },
      {
        debugger: true,
        devtools_method: "Target.getTargetInfo",
        method: "devtools",
        params: {},
        session_id: "S",
      },
      { method: "debugger_detach" },
    ]);
    // Electron's own detach says so too.
    expect(heard).toEqual([["detach", "target closed"]]);
  });

  it("refuses a second attach, a protocol version DevTools lacks, and a command while detached", async () => {
    const { debug } = fakeDebugger();

    expect(() => debug.attach("0.9")).toThrow(
      "Requested protocol version is not supported",
    );
    await expect(debug.sendCommand("Page.reload")).rejects.toThrow(
      "No target available",
    );
    debug.attach();
    expect(() => debug.attach()).toThrow(
      "Another debugger is already attached",
    );
  });

  it("hands on its client's events, and its detaching", () => {
    const { debug, heard } = fakeDebugger();
    debug.attach();

    debug.receive("Page.loadEventFired", { timestamp: 1 }, undefined);
    debug.receive("Network.dataReceived", {}, "S");
    debug.detached("target closed");
    debug.receive("Page.loadEventFired", {}, undefined);

    expect(heard).toEqual([
      ["message", "Page.loadEventFired", { timestamp: 1 }, ""],
      ["message", "Network.dataReceived", {}, "S"],
      ["detach", "target closed"],
    ]);
    expect(debug.isAttached()).toBe(false);
  });

  it("rejects a command DevTools refuses, and detaches when the attach fails", async () => {
    const { debug, heard } = fakeDebugger((method) =>
      method.method === "debugger_attach"
        ? Promise.reject(new Error("the page has opened nothing yet"))
        : Promise.reject(new Error("'Nope.x' wasn't found")),
    );

    debug.attach();
    await expect(debug.sendCommand("Nope.x")).rejects.toThrow(
      "the page has opened nothing yet",
    );

    expect(debug.isAttached()).toBe(false);
    expect(heard).toEqual([["detach", "target closed"]]);
  });
});
