import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { DevToolsEvents, PageMethod } from "./page-control";
import { createPageSaves } from "./page-saves";

/** A page whose DevTools answers from `answer`, and the files it writes. */
const fakePage = (
  answer: (
    method: string,
    params: Readonly<Record<string, unknown>>,
    devtools: DevToolsEvents,
  ) => unknown = () => ({}),
) => {
  const called: PageMethod[] = [];
  const written: [string, string][] = [];
  const devtools: DevToolsEvents = new EventEmitter();
  const saves = createPageSaves(
    {
      call: (method) => {
        called.push(method);
        return method.method === "devtools"
          ? Promise.resolve(
              answer(method.devtools_method, method.params, devtools),
            )
          : Promise.reject(new Error(`no ${method.method}`));
      },
      devtools,
    },
    (path, data) => {
      written.push([path, data]);
      return Promise.resolve();
    },
  );
  return { called, devtools, saves, written };
};

const methods = (called: readonly PageMethod[]) =>
  called.map((method) =>
    method.method === "devtools" ? method.devtools_method : method.method,
  );

describe(createPageSaves, () => {
  it("writes a heap snapshot from its chunks", async () => {
    const { called, saves, written } = fakePage((method, _params, devtools) => {
      if (method === "HeapProfiler.takeHeapSnapshot") {
        devtools.emit("HeapProfiler.addHeapSnapshotChunk", { chunk: '{"a":' });
        devtools.emit("HeapProfiler.addHeapSnapshotChunk", { chunk: "1}" });
      }
      return {};
    });

    await saves.takeHeapSnapshot("/tmp/a.heapsnapshot");

    expect(written).toEqual([["/tmp/a.heapsnapshot", '{"a":1}']]);
    expect(methods(called)).toEqual([
      "HeapProfiler.enable",
      "HeapProfiler.takeHeapSnapshot",
      "HeapProfiler.disable",
    ]);
  });

  it("refuses a heap snapshot the page fails to take, and writes nothing", async () => {
    const { saves, written } = fakePage((method) => {
      if (method === "HeapProfiler.takeHeapSnapshot") {
        throw new Error("out of memory");
      }
      return {};
    });

    await expect(saves.takeHeapSnapshot("/tmp/a")).rejects.toThrow(
      "Failed to take heap snapshot",
    );
    expect(written).toEqual([]);
  });

  describe("savePage", () => {
    it("saves the page as MHTML", async () => {
      const { called, saves, written } = fakePage(() => ({ data: "MIME" }));

      await saves.savePage("/tmp/a.mhtml", "MHTML");

      expect(written).toEqual([["/tmp/a.mhtml", "MIME"]]);
      expect(called).toEqual([
        {
          devtools_method: "Page.captureSnapshot",
          method: "devtools",
          params: { format: "mhtml" },
        },
      ]);
    });

    it("refuses the HTML saves, which only a download makes", async () => {
      const { saves } = fakePage();

      for (const type of ["HTMLOnly", "HTMLComplete"] as const) {
        await expect(saves.savePage("/tmp/a.html", type)).rejects.toThrow(
          `savePage saves only MHTML on Domicile, not ${type}`,
        );
      }
      await expect(saves.savePage("/tmp/a", "PDF")).rejects.toThrow(
        "Unknown saveType PDF",
      );
    });
  });

  describe("collectJavaScriptCallStack", () => {
    it("pauses the running script, gives its stack and lets it go", async () => {
      const { called, devtools, saves } = fakePage();

      const stack = saves.collectJavaScriptCallStack();
      await Bun.sleep(0);
      devtools.emit("Debugger.paused", {
        callFrames: [
          {
            functionName: "spin",
            location: { columnNumber: 4, lineNumber: 9 },
            url: "app://a/x.js",
          },
          {
            functionName: "",
            location: { columnNumber: 0, lineNumber: 0 },
            url: "app://a/index.html",
          },
        ],
      });

      expect(await stack).toBe(
        "    at spin (app://a/x.js:10:5)\n    at app://a/index.html:1:1",
      );
      expect(methods(called)).toEqual([
        "Debugger.enable",
        "Debugger.pause",
        "Debugger.resume",
        "Debugger.disable",
      ]);
    });

    it("waits while no script runs, as Electron's does", async () => {
      const { saves } = fakePage();

      const stack = saves.collectJavaScriptCallStack();
      const settled = await Promise.race([
        stack.then(() => "settled"),
        Bun.sleep(5).then(() => "waiting"),
      ]);

      expect(settled).toBe("waiting");
    });
  });
});
