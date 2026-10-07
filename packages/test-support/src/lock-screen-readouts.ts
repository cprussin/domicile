// The lock screen's recorded system requests, and a host that records what a
// library sends, so each library's tests check it sends exactly its lines.
// See packages/domicile-protocol/wire/README.md.

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const FIXTURE = path.join(
  import.meta.dir,
  "../../domicile-protocol/wire/lock-screen-readouts.jsonl",
);

/** Calls that end or quiet something already running. */
const STOPS: readonly string[] = ["unwatch", "kill", "close_stdin"];

/** The requests recorded for `library`, such as `"system-battery"`. */
export const lockScreenReadouts = (library: string): unknown[] =>
  readFileSync(FIXTURE, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => readoutSchema.parse(JSON.parse(line)))
    .filter((readout) => readout.library === library)
    .map((readout) => readout.request);

/**
 * A `SystemHost` that keeps each call sent, parsed, in `sent`. Calls that only
 * stop something are left out: a locked desktop runs those anyway.
 *
 * A spawn starts and exits with code 1, a D-Bus match starts, and anything
 * else fails, so a library goes on to its next call.
 */
export const recordingHost = () => {
  const sent: unknown[] = [];
  const listeners: ((event: MessageEvent<string>) => void)[] = [];
  const tell = (message: object) => {
    for (const listener of listeners) {
      listener(new MessageEvent("system", { data: JSON.stringify(message) }));
    }
  };
  const host = {
    addEventListener: (
      _type: "system",
      listener: (event: MessageEvent<string>) => void,
    ) => {
      listeners.push(listener);
    },
    callSystem: (id: number, line: string) => {
      const request = callSchema.parse(JSON.parse(line));
      if (!STOPS.includes(request.call)) {
        sent.push(request);
        queueMicrotask(() => {
          answer(tell, id, request.call);
        });
      }
    },
  };
  return { host, sent };
};

const readoutSchema = z.object({
  library: z.string(),
  request: z.looseObject({ call: z.string() }),
});

const callSchema = z.looseObject({ call: z.string() });

const answer = (
  tell: (message: object) => void,
  id: number,
  call: string,
): void => {
  switch (call) {
    case "spawn": {
      tell({ id, reply: { kind: "started" }, type: "system_reply" });
      tell({
        end: { code: 1, kind: "exited", signal: null },
        id,
        type: "system_end",
      });
      break;
    }
    case "dbus_match": {
      tell({ id, reply: { kind: "started" }, type: "system_reply" });
      break;
    }
    default: {
      tell({
        id,
        reply: {
          error: { kind: "other", message: "recorded" },
          kind: "failed",
        },
        type: "system_reply",
      });
    }
  }
};
