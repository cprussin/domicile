import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type { Exit, SystemError } from "@domicile-desktop/sdk/system";
import { Signal, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { spawnedAppHost } from "./client";
import { fakeDesktop, settled, started } from "./fake";

const replies = z.discriminatedUnion("type", [
  z.object({
    id: z.number(),
    times: z.array(z.number()),
    type: z.literal("visits"),
  }),
  z.object({ id: z.number(), type: z.literal("opened") }),
]);

/** A client of `replies`, asking for visits. */
const visits = (
  processes: Pick<Processes, "spawn">,
  onEvent?: (message: unknown) => void,
) => {
  const host = spawnedAppHost({ onEvent, processes, replies });
  return () =>
    host
      .ask({ type: "visits", url: "https://a.test/" }, "visits")
      .then((reply) => reply.times);
};

describe(spawnedAppHost, () => {
  describe("requests", () => {
    it("sends each request with an id and resolves with its reply", async () => {
      const { asked, processes } = await started(visits, (ask) => ask());
      expect(processes[0]?.sent).toEqual([
        { id: 1, type: "visits", url: "https://a.test/" },
      ]);
      processes[0]?.answer({ id: 1, times: [4], type: "visits" });
      expect(await asked).toEqual([4]);
    });

    it("takes a reply split across reads", async () => {
      const { asked, processes } = await started(visits, (ask) => ask());
      processes[0]?.answer({ id: 1, times: [4], type: "visits" }, 2);
      expect(await asked).toEqual([4]);
    });

    it("rejects with the host's reason when it refuses", async () => {
      const { asked, processes } = await started(visits, (ask) => ask());
      processes[0]?.answer({ id: 1, type: "refused", why: "profile is busy" });
      await expect(asked).rejects.toThrow("profile is busy");
    });

    it("rejects a reply of the wrong type", async () => {
      const { asked, processes } = await started(visits, (ask) => ask());
      processes[0]?.answer({ id: 1, type: "opened" });
      await expect(asked).rejects.toThrow(
        "The app host answered opened, not visits",
      );
    });

    it("hands an event to the app", async () => {
      const events: unknown[] = [];
      const { asked, processes } = await started(
        (processes) => visits(processes, (event) => events.push(event)),
        (ask) => ask(),
      );
      processes[0]?.answer({ type: "changed" });
      processes[0]?.answer({ id: 1, times: [], type: "visits" });
      await asked;
      expect(events).toEqual([{ type: "changed" }]);
    });
  });

  it("starts the host for its events before anything is asked", async () => {
    const events: unknown[] = [];
    const { processes, system } = fakeDesktop();
    spawnedAppHost({
      onEvent: (event) => events.push(event),
      processes: system,
      replies,
    }).start();
    await settled();
    processes[0]?.answer({ type: "changed" });
    await settled();
    expect(events).toEqual([{ type: "changed" }]);
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
        const { asked, host, processes } = await started(visits, (ask) =>
          ask(),
        );
        processes[0]?.end(exit, stderr);
        await expect(asked).rejects.toThrow(why);

        const again = host();
        await settled();
        expect(processes).toHaveLength(2);
        processes[1]?.answer({ id: 2, times: [1], type: "visits" });
        expect(await again).toEqual([1]);
      },
    );

    it("fails what was asked when it cannot start, and tries again for the next", async () => {
      const { processes, system } = fakeDesktop([
        {
          kind: SystemErrorKind.NotFound,
          message: "No such file or directory",
        },
      ]);
      const ask = visits(system);
      await expect(ask()).rejects.toThrow("No such file or directory");

      const again = ask();
      await settled();
      processes[0]?.answer({ id: 2, times: [1], type: "visits" });
      expect(await again).toEqual([1]);
    });

    it.each([
      ["of an unknown type", { id: 1, type: "nonsense" }],
      ["to a request never made", { id: 9, type: "opened" }],
      ["refusing a request never made", { id: 9, type: "refused", why: "no" }],
      ["as an event the app does not hear", { type: "changed" }],
    ])(
      "stops a host that sends a message %s, failing what was asked",
      async (_, message) => {
        const { asked, processes } = await started(visits, (ask) => ask());
        processes[0]?.answer(message);
        await expect(asked).rejects.toThrow("The app host sent a bad message");
        expect(processes[0]?.killed).toEqual([Signal.Term]);
      },
    );
  });
});
