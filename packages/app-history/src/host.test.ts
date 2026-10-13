import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import {
  encodeFrame,
  frameDecoder,
} from "@domicile-desktop/component-library/app-host-frames";
import type {
  Exit,
  Subprocess,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Signal, SystemErrorKind } from "@domicile-desktop/sdk/system";

import { spawnedHost } from "./host";

/** A started host process, as a test drives it. */
type FakeProcess = {
  /** Each message the app wrote to its stdin. */
  sent: unknown[];
  /** Writes `message` to its stdout, as one frame or split in two. */
  answer: (message: unknown, split?: number) => void;
  /** Ends it, after writing `stderr`. */
  end: (exit: Result<Exit, SystemError>, stderr?: string) => void;
  /** Each signal the app sent it. */
  killed: Signal[];
};

/**
 * A `spawn` that starts fake processes, or fails with each of `failures`
 * first.
 */
const fakeSystem = (failures: SystemError[] = []) => {
  const processes: FakeProcess[] = [];
  const system: Pick<System, "spawn"> = {
    spawn: (argv, options) => {
      expect(argv).toEqual(["domicile-app-host"]);
      expect(options).toEqual({ stdin: true });
      const failure = failures.shift();
      return Promise.resolve(
        failure === undefined ? Ok(fakeProcess(processes)) : Err(failure),
      );
    },
  };
  return { processes, system };
};

/** A process whose controls go in `processes`. */
const fakeProcess = (processes: FakeProcess[]): Subprocess => {
  const stdout = pushed();
  const stderr = pushed();
  const { promise: exited, resolve: settle } =
    Promise.withResolvers<Result<Exit, SystemError>>();
  const decode = frameDecoder();
  const sent: unknown[] = [];
  const killed: Signal[] = [];
  const end = (exit: Result<Exit, SystemError>, text = "") => {
    stderr.push(new TextEncoder().encode(text));
    stdout.close();
    stderr.close();
    settle(exit);
  };
  processes.push({
    answer: (message, split = 0) => {
      const frame = encodeFrame(message);
      stdout.push(frame.slice(0, split));
      stdout.push(frame.slice(split));
    },
    end,
    killed,
    sent,
  });
  return {
    closeStdin: () => {
      throw new Error("The app never closes the host's stdin");
    },
    exited,
    kill: (signal = Signal.Term) => {
      killed.push(signal);
      end(Ok({ code: undefined, signal: 15 }));
    },
    stderr: stderr.stream,
    stdout: stdout.stream,
    write: (data) => {
      sent.push(
        ...decode(
          typeof data === "string" ? new TextEncoder().encode(data) : data,
        ),
      );
    },
  };
};

/** A stream the test writes to. */
const pushed = () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start: (started) => {
      controller = started;
    },
  });
  return {
    close: () => {
      controller?.close();
    },
    push: (chunk: Uint8Array) => {
      controller?.enqueue(chunk);
    },
    stream,
  };
};

/** Lets the host spawn and write what it was asked. */
const settled = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** The host over a fake system, with what it already asked. */
const started = async <T>(ask: (host: ReturnType<typeof spawnedHost>) => T) => {
  const fake = fakeSystem();
  const host = spawnedHost(fake.system);
  const asked = ask(host);
  await settled();
  return { ...fake, asked, host };
};

const QUERY = { endTime: 5, maxResults: 150, text: "a" };

describe(spawnedHost, () => {
  describe("requests", () => {
    it("searches the history, with each page's icon if it has one", async () => {
      const { asked, processes } = await started((host) => host.history(QUERY));
      expect(processes[0]?.sent).toEqual([
        { end_time: 5, id: 1, max_results: 150, text: "a", type: "history" },
      ]);
      processes[0]?.answer(
        {
          id: 1,
          items: [
            {
              favicon: "data:image/png;base64,QQ==",
              title: "A",
              url: "https://a.test/",
            },
            { favicon: null, title: "", url: "https://b.test/" },
          ],
          type: "history",
        },
        2,
      );
      expect(await asked).toEqual([
        {
          favicon: "data:image/png;base64,QQ==",
          title: "A",
          url: "https://a.test/",
        },
        { favicon: undefined, title: "", url: "https://b.test/" },
      ]);
    });

    it("gives a page's visit times", async () => {
      const { asked, processes } = await started((host) =>
        host.visits("https://a.test/"),
      );
      expect(processes[0]?.sent).toEqual([
        { id: 1, type: "visits", url: "https://a.test/" },
      ]);
      processes[0]?.answer({ id: 1, times: [10.5, 20], type: "visits" });
      expect(await asked).toEqual([10.5, 20]);
    });

    it("deletes visits, clears browsing data and opens a URL", async () => {
      const { asked, host, processes } = await started((host) =>
        host.deleteHistory([1000, 2000]),
      );
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 1,
        type: "delete_history",
        visits: [1000, 2000],
      });
      processes[0]?.answer({ id: 1, type: "deleted" });
      await asked;

      const cleared = host.clearBrowsingData({
        origins: ["https://a.test"],
        since: 0,
        types: ["cookies"],
      });
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 2,
        origins: ["https://a.test"],
        since: 0,
        type: "clear_browsing_data",
        types: ["cookies"],
      });
      processes[0]?.answer({ id: 2, type: "cleared" });
      await cleared;

      const opened = host.openUrl("https://a.test/");
      await settled();
      expect(processes[0]?.sent.at(-1)).toEqual({
        id: 3,
        type: "open_url",
        url: "https://a.test/",
      });
      processes[0]?.answer({ id: 3, type: "opened" });
      await opened;
    });

    it("rejects with the host's reason when it refuses", async () => {
      const { asked, processes } = await started((host) =>
        host.clearBrowsingData({ since: 42, types: ["cache"] }),
      );
      expect(processes[0]?.sent).toEqual([
        { id: 1, since: 42, type: "clear_browsing_data", types: ["cache"] },
      ]);
      processes[0]?.answer({ id: 1, type: "refused", why: "profile is busy" });
      await expect(asked).rejects.toThrow("profile is busy");
    });

    it("rejects a reply of the wrong type", async () => {
      const { asked, processes } = await started((host) =>
        host.openUrl("https://a.test/"),
      );
      processes[0]?.answer({ id: 1, type: "deleted" });
      await expect(asked).rejects.toThrow(
        "The app host answered deleted, not opened",
      );
    });
  });

  describe("the process", () => {
    it.each([
      [
        "its stderr",
        Ok({ code: 1, signal: undefined }),
        "domicile-app-host: DOMICILE_SOCK is not set\n",
        "domicile-app-host: DOMICILE_SOCK is not set",
      ],
      [
        "its exit code",
        Ok({ code: 1, signal: undefined }),
        "",
        "The app host exited with code 1",
      ],
      [
        "the signal that killed it",
        Ok({ code: undefined, signal: 9 }),
        "",
        "The app host was killed by signal 9",
      ],
      [
        "why it could not be followed",
        Err({ kind: SystemErrorKind.Other, message: "the desktop went away" }),
        "",
        "the desktop went away",
      ],
    ] satisfies [string, Result<Exit, SystemError>, string, string][])(
      "fails what was asked with %s when it ends, and starts again for the next",
      async (_, exit, stderr, why) => {
        const { asked, host, processes } = await started((host) =>
          host.visits("https://a.test/"),
        );
        processes[0]?.end(exit, stderr);
        await expect(asked).rejects.toThrow(why);

        const again = host.visits("https://a.test/");
        await settled();
        expect(processes).toHaveLength(2);
        processes[1]?.answer({ id: 2, times: [1], type: "visits" });
        expect(await again).toEqual([1]);
      },
    );

    it("fails what was asked when it cannot start, and tries again for the next", async () => {
      const { processes, system } = fakeSystem([
        {
          kind: SystemErrorKind.NotFound,
          message: "No such file or directory",
        },
      ]);
      const host = spawnedHost(system);
      await expect(host.visits("https://a.test/")).rejects.toThrow(
        "No such file or directory",
      );

      const again = host.visits("https://a.test/");
      await settled();
      processes[0]?.answer({ id: 2, times: [1], type: "visits" });
      expect(await again).toEqual([1]);
    });

    it.each([
      ["of an unknown type", { id: 1, type: "nonsense" }],
      ["to a request never made", { id: 9, type: "deleted" }],
    ])(
      "stops a host that sends a reply %s, failing what was asked",
      async (_, reply) => {
        const { asked, processes } = await started((host) =>
          host.visits("https://a.test/"),
        );
        processes[0]?.answer(reply);
        await expect(asked).rejects.toThrow("The app host sent a bad message");
        expect(processes[0]?.killed).toEqual([Signal.Term]);
      },
    );
  });
});
