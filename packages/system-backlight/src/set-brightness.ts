// Sets the screen's backlight through logind.
//
// `/sys/class/backlight/*/brightness` is writable only by root. logind's
// `Session.SetBrightness` lets the session's owner set it without a udev rule
// or a setuid helper.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { rawFor } from "./raw-for";
import type { SysfsHost } from "./read-backlight";
import { readBacklight } from "./read-backlight";

export enum SetOutcome {
  /** logind set it. */
  Set,
  /** A newer level was asked for before this one was sent. */
  Superseded,
  NoBacklight,
}

/** The calls {@link brightnessSetter} makes. */
export type SetterHost = SysfsHost & Pick<System, "dbusCall">;

/** Sets the backlight to a level from 0 to 1, and says how it went. */
export type SetBrightness = (
  level: number,
) => Promise<Result<SetOutcome, SystemError>>;

/**
 * A function that sets the preferred backlight to a level from 0 to 1.
 *
 * - Reads the device again for each level, since the raw scale is the
 *   device's and it may have gone away.
 * - Never sets zero; see `rawFor`.
 * - Sends one level at a time. A dragged slider asks many times while logind
 *   answers once, so only the newest level waiting is sent and the others
 *   resolve {@link SetOutcome.Superseded}.
 * - A level that is not a number rejects.
 */
export const brightnessSetter = (host: SetterHost): SetBrightness => {
  const queue: Queue = { pending: undefined, sending: false };
  return (level) => {
    if (queue.sending) {
      queue.pending?.settle(Ok(SetOutcome.Superseded));
      return new Promise((settle, fail) => {
        queue.pending = { fail, level, settle };
      });
    } else {
      queue.sending = true;
      return sendFrom(host, queue, level);
    }
  };
};

type Settled = Result<SetOutcome, SystemError>;

/** The level being sent and the newest one waiting. */
type Queue = {
  sending: boolean;
  pending:
    | {
        level: number;
        settle: (result: Settled) => void;
        fail: (error: unknown) => void;
      }
    | undefined;
};

/** Send `level`, then whatever waits behind it. */
const sendFrom = async (
  host: SetterHost,
  queue: Queue,
  level: number,
): Promise<Settled> => {
  try {
    return await send(host, level);
  } finally {
    const next = queue.pending;
    queue.pending = undefined;
    if (next === undefined) {
      queue.sending = false;
    } else {
      sendFrom(host, queue, next.level).then(next.settle, next.fail);
    }
  }
};

const send = async (host: SetterHost, level: number): Promise<Settled> =>
  (await readBacklight(host)).andThenAsync(async (read) =>
    read.match<Promise<Settled>>({
      None: async () => Ok(SetOutcome.NoBacklight),
      Some: async (backlight) =>
        (
          await host.dbusCall({
            body: ["backlight", backlight.device, rawFor(backlight, level)],
            bus: Bus.System,
            destination: "org.freedesktop.login1",
            interface: "org.freedesktop.login1.Session",
            member: "SetBrightness",
            path: "/org/freedesktop/login1/session/auto",
            signature: "ssu",
          })
        ).map(({ body }) => {
          returnsNothing.parse(body);
          return SetOutcome.Set;
        }),
    }),
  );

const returnsNothing = z.tuple([]);
