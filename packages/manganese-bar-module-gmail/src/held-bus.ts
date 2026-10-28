// A test double for the session bus: each call answers the next reply, and
// the test sends signals to every match.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Listened } from "@domicile-desktop/sdk/system";

export const heldBus = (replies: Result<DbusBody, SystemError>[]) => {
  const calls: DbusCall[] = [];
  const matches: DbusMatch[] = [];
  const signals =
    Promise.withResolvers<
      ReadableStreamDefaultController<Listened<DbusSignal>>
    >();
  const items = new ReadableStream<Listened<DbusSignal>>({
    start: (controller) => {
      signals.resolve(controller);
    },
  });
  return {
    calls,
    dbus: {
      call: (call: DbusCall) => {
        calls.push(call);
        const reply = replies.shift();
        if (reply === undefined) {
          throw new Error(`test: no reply for ${call.member}`);
        } else {
          return Promise.resolve(reply);
        }
      },
      match: (match: DbusMatch) => {
        matches.push(match);
        return Promise.resolve(
          Ok<Listening<Listened<DbusSignal>>, SystemError>({
            ended: new Promise(() => undefined),
            items,
            stop: () => undefined,
          }),
        );
      },
    },
    matches,
    /** Says the compositor restarted under the match. */
    miss: async () => {
      (await signals.promise).enqueue(Listened.Missed());
    },
    send: async (sent: DbusSignal) => {
      (await signals.promise).enqueue(Listened.Heard(sent));
    },
  };
};
