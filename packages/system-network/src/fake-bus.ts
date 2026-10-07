// The system bus for tests: method calls answered by the test, and signals
// the test sends, in the compositor's JSON.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { Network } from "./network-state";

export const SERVICE_UNKNOWN: SystemError = {
  kind: SystemErrorKind.Dbus,
  message:
    "org.freedesktop.DBus.Error.ServiceUnknown: The name is not activatable",
};

/** Replies by object path. */
export type Objects = Map<string, Result<DbusBody, SystemError>>;

/** Answers each call from `objects`, by its path. */
export const byPath =
  (objects: Objects) =>
  (call: DbusCall): Result<DbusBody, SystemError> => {
    const reply = objects.get(call.path);
    if (reply === undefined) {
      throw new Error(`test: no object at ${call.path}`);
    } else {
      return reply;
    }
  };

/**
 * The system bus as a library sees it: `answer` replies to each call, and the
 * test sends signals to the match. A match fails with `refused` when it is
 * given.
 */
export const fakeBus = (
  answer: (call: DbusCall) => Result<DbusBody, SystemError>,
  refused?: SystemError,
) => {
  const calls: DbusCall[] = [];
  const matches: DbusMatch[] = [];
  const signals =
    Promise.withResolvers<ReadableStreamDefaultController<DbusSignal>>();
  const ended = Promise.withResolvers<Result<"stopped", SystemError>>();
  const items = new ReadableStream<DbusSignal>({
    start: (controller) => {
      signals.resolve(controller);
    },
  });
  const state = { stopped: 0 };
  return {
    break: async (error: SystemError) => {
      (await signals.promise).close();
      ended.resolve(Err(error));
    },
    calls,
    matches,
    send: async (signal: DbusSignal) => {
      (await signals.promise).enqueue(signal);
    },
    get stopped() {
      return state.stopped;
    },
    system: {
      dbusCall: (call: DbusCall) => {
        calls.push(call);
        return Promise.resolve(answer(call));
      },
      dbusMatch: (match: DbusMatch) => {
        matches.push(match);
        return Promise.resolve(
          refused === undefined
            ? Ok<Listening<DbusSignal>, SystemError>({
                ended: ended.promise,
                items,
                stop: () => {
                  state.stopped += 1;
                  signals.promise
                    .then((controller) => {
                      controller.close();
                      ended.resolve(Ok("stopped"));
                    })
                    .catch(() => {
                      /* the test fails on the missing report instead */
                    });
                },
              })
            : Err<Listening<DbusSignal>, SystemError>(refused),
        );
      },
    },
  };
};

/** A `PropertiesChanged` signal from `path`. */
export const propertiesChanged = (
  path: string,
  interfaceName: string,
  changed: Record<string, unknown>,
): DbusSignal => ({
  body: [interfaceName, changed, []],
  interface: "org.freedesktop.DBus.Properties",
  member: "PropertiesChanged",
  path,
  sender: ":1.7",
  signature: "sa{sv}as",
});

/** The reports a watch makes, read one at a time. */
export const reports = () => {
  const queue: Result<Network, SystemError>[] = [];
  const waiting: ((report: Result<Network, SystemError>) => void)[] = [];
  return {
    next: (): Promise<Result<Network, SystemError>> => {
      const report = queue.shift();
      return report === undefined
        ? new Promise((resolve) => {
            waiting.push(resolve);
          })
        : Promise.resolve(report);
    },
    on: (report: Result<Network, SystemError>) => {
      const resolve = waiting.shift();
      if (resolve === undefined) {
        queue.push(report);
      } else {
        resolve(report);
      }
    },
    get pending() {
      return queue.length;
    },
  };
};
