import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type {
  Listened as Heard,
  SystemError,
  Watch,
} from "@domicile-desktop/sdk/system";
import { Listened, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { fakeDesktop } from "@domicile-desktop/system-apps/fake-desktop";

import type { FolderFiles } from "./folders";
import { desktopFolders } from "./folders";

describe("desktopFolders", () => {
  it("creates a directory, and says why it could not", async () => {
    const made: string[] = [];
    const files: FolderFiles = {
      ...fakeDesktop({}).files,
      createDir: (path) => {
        made.push(path);
        return Promise.resolve(
          path === "/home/someone/taken"
            ? Err<"created", SystemError>({
                kind: SystemErrorKind.AlreadyExists,
                message: "File exists",
              })
            : Ok<"created", SystemError>("created"),
        );
      },
    };
    const folders = desktopFolders(files);

    expect(await folders.create("/home/someone/new")).toStrictEqual(
      Ok("created"),
    );
    expect(await folders.create("/home/someone/taken")).toStrictEqual(
      Err({ kind: SystemErrorKind.AlreadyExists, message: "File exists" }),
    );
    expect(made).toStrictEqual(["/home/someone/new", "/home/someone/taken"]);
  });

  it("calls back on each change heard, or missed, until stopped", async () => {
    const watch = controlledWatch();
    const watched: string[] = [];
    const files: FolderFiles = {
      ...fakeDesktop({}).files,
      watch: (path) => {
        watched.push(path);
        return Promise.resolve(Ok<Watch, SystemError>(watch.watch));
      },
    };
    const changes: string[] = [];

    const stop = desktopFolders(files).watch("/home/someone", () => {
      changes.push("changed");
    });
    await watch.hear(Listened.Heard("/home/someone/a"));
    await watch.hear(Listened.Missed());
    stop();

    expect(watched).toStrictEqual(["/home/someone"]);
    expect(changes).toStrictEqual(["changed", "changed"]);
    expect(watch.stopped()).toBe(true);
  });

  it("stops a watch that starts after it was stopped", async () => {
    const watch = controlledWatch();
    const starting = Promise.withResolvers<void>();
    const files: FolderFiles = {
      ...fakeDesktop({}).files,
      watch: async () => {
        await starting.promise;
        return Ok<Watch, SystemError>(watch.watch);
      },
    };

    const stop = desktopFolders(files).watch("/home/someone", () => {
      throw new Error("heard a change after stopping");
    });
    stop();
    starting.resolve();
    await watch.hear(Listened.Heard("/home/someone/a"));

    expect(watch.stopped()).toBe(true);
  });
});

/** A watch whose changes the test sends. */
const controlledWatch = () => {
  let send: ReadableStreamDefaultController<Heard<string>> | undefined;
  let stopped = false;
  const items = new ReadableStream<Heard<string>>({
    start: (controller) => {
      send = controller;
    },
  });
  const watch: Watch = {
    ended: Promise.resolve(Ok("stopped")),
    items,
    stop: () => {
      stopped = true;
      send?.close();
    },
  };
  return {
    /** Sends `item` unless stopped, and lets the reader take it. */
    hear: async (item: Heard<string>) => {
      if (!stopped) {
        send?.enqueue(item);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    },
    stopped: () => stopped,
    watch,
  };
};
