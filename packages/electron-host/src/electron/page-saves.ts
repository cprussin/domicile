// The webContents and webFrameMain members that read the page out through
// its DevTools client: heap snapshots, MHTML and the running script's stack.

import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PageCaller } from "./page-control";

/** Writes `data` to the file at `path`. */
type WriteFile = (path: string, data: string) => Promise<void>;

/** savePage's types, by Electron's names. */
type SaveType = "HTMLOnly" | "HTMLComplete" | "MHTML";

/** A page's members that read it out through DevTools. */
export const createPageSaves = (
  page: Pick<PageCaller, "call" | "devtools">,
  write: WriteFile = (path, data) => writeFile(path, data),
) => {
  const devtools = (method: string, params: Record<string, unknown> = {}) =>
    page.call({ devtools_method: method, method: "devtools", params });
  /** The stack being collected, which every caller meanwhile shares. */
  let collecting: Promise<string> | undefined;

  const takeSnapshot = async () => {
    const chunks: string[] = [];
    const onChunk = (params: Readonly<Record<string, unknown>>) => {
      chunks.push(snapshotChunk.parse(params).chunk);
    };
    page.devtools.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    try {
      await devtools("HeapProfiler.enable");
      await devtools("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
      });
      await devtools("HeapProfiler.disable");
      return chunks.join("");
    } finally {
      page.devtools.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    }
  };

  /** Pauses the page's next statement, and lets it go with its stack. */
  const collect = async () => {
    const paused = new Promise<Readonly<Record<string, unknown>>>((resolve) => {
      page.devtools.once("Debugger.paused", resolve);
    });
    await devtools("Debugger.enable");
    await devtools("Debugger.pause");
    const { callFrames } = pausedAt.parse(await paused);
    await devtools("Debugger.resume");
    await devtools("Debugger.disable");
    return callFrames.map(stackLine).join("\n");
  };

  return {
    /**
     * The stack of the script running in the page, as V8 writes one. Waits
     * while none runs, as Electron's does.
     */
    collectJavaScriptCallStack: () => {
      collecting ??= collect().finally(() => {
        collecting = undefined;
      });
      return collecting;
    },

    /** Saves the page to `fullPath`: as MHTML, the one type DevTools gives. */
    savePage: async (fullPath: string, saveType: SaveType | string) => {
      switch (saveType) {
        case "MHTML": {
          const { data } = withData.parse(
            await devtools("Page.captureSnapshot", { format: "mhtml" }),
          );
          await write(fullPath, data);
          break;
        }
        case "HTMLOnly":
        case "HTMLComplete": {
          // Chromium's HTML saves go through its download manager, as
          // Electron's do, and the engine doesn't carry them out yet.
          throw new Error(
            `savePage saves only MHTML on Domicile, not ${saveType}`,
          );
        }
        default: {
          throw new TypeError(`Unknown saveType ${saveType}`);
        }
      }
    },

    /** Writes a heap snapshot of the page's renderer to `filePath`. */
    takeHeapSnapshot: async (filePath: string) => {
      const snapshot = await takeSnapshot().catch((error: unknown) => {
        throw new Error("Failed to take heap snapshot", { cause: error });
      });
      await write(filePath, snapshot);
    },
  };
};

/** One line of a V8 stack trace for a DevTools call frame. */
const stackLine = ({
  functionName,
  location,
  url,
}: z.infer<typeof callFrame>) => {
  const where = `${url}:${location.lineNumber + 1}:${location.columnNumber + 1}`;
  return functionName === ""
    ? `    at ${where}`
    : `    at ${functionName} (${where})`;
};

/** A HeapProfiler.addHeapSnapshotChunk event's parameters. */
const snapshotChunk = z.object({ chunk: z.string() });

/** A Page.captureSnapshot answer. */
const withData = z.object({ data: z.string() });

/** A DevTools call frame, as far as a stack line needs it. */
const callFrame = z.object({
  functionName: z.string(),
  location: z.object({ columnNumber: z.number(), lineNumber: z.number() }),
  url: z.string(),
});

/** A Debugger.paused event's parameters that a stack needs. */
const pausedAt = z.object({ callFrames: z.array(callFrame) });
