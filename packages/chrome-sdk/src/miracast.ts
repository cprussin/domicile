// Miracast TVs, through the `domicile-miracast` service on the session bus.
// See docs/CASTING-TO-TVS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

import type { CastBackend, CastTarget, Sending } from "./cast";
import type { Dbus } from "./desktop/dbus";
import type { DbusSignal, Listened, Listening, SystemError } from "./system";
import { Bus, ListenedKind } from "./system";

const SERVICE = "net.domicile.Miracast";
const PATH = "/net/domicile/Miracast";
const INTERFACE = "net.domicile.Miracast1";

/**
 * The mode an extended desk takes on a Miracast TV: the service sends at
 * most 1080p30.
 */
const MIRACAST_MODE = { height: 1080, refreshMhz: 30_000, width: 1920 };

const SINKS = z.tuple([z.array(z.tuple([z.string(), z.string()]))]);
const CAST = z.tuple([z.string()]);
const ENDED = z.tuple([z.string(), z.string()]);

/** What {@link miracastCast} needs of the desktop. */
export type MiracastDesktop = { readonly dbus: Pick<Dbus, "call" | "match"> };

/**
 * Miracast, as a backend: TVs over Wi-Fi Direct and the LAN. The service
 * starts on the first call; where it is not installed, no TV is listed. One
 * backend per desktop, so every bar's `Cast` item shares one watch.
 */
export const miracastCast = (domicile: MiracastDesktop): CastBackend => {
  const known = backends.get(domicile);
  if (known === undefined) {
    const made = backend(domicile);
    backends.set(domicile, made);
    return made;
  } else {
    return known;
  }
};

const backends = new WeakMap<MiracastDesktop, CastBackend>();

/** Every listener of one desktop's TVs, and the one watch they share. */
type Shared = {
  listeners: Set<(targets: readonly CastTarget[]) => void>;
  last: readonly CastTarget[] | undefined;
  watch: Watch | undefined;
};

type Watch = { listening?: Listening<Listened<DbusSignal>>; stopped: boolean };

const backend = (domicile: MiracastDesktop): CastBackend => {
  const shared: Shared = {
    last: undefined,
    listeners: new Set(),
    watch: undefined,
  };
  return {
    // D-Bus starts the service outside any app's scope, so the portal names
    // no app.
    appId: "",
    send: (targetId) => send(domicile, targetId),
    watchTargets: (listener) => {
      shared.listeners.add(listener);
      if (shared.watch === undefined) {
        const watch: Watch = { stopped: false };
        shared.watch = watch;
        void watchSinks(domicile, watch, (targets) => {
          shared.last = targets;
          for (const each of shared.listeners) {
            each(targets);
          }
        });
      } else if (shared.last !== undefined) {
        listener(shared.last);
      }
      return () => {
        shared.listeners.delete(listener);
        if (shared.listeners.size === 0 && shared.watch !== undefined) {
          shared.watch.stopped = true;
          shared.watch.listening?.stop();
          shared.watch = undefined;
          shared.last = undefined;
        }
      };
    },
  };
};

const call = (
  domicile: MiracastDesktop,
  member: string,
  args?: { signature: string; body: readonly unknown[] },
) =>
  domicile.dbus.call({
    bus: Bus.Session,
    destination: SERVICE,
    interface: INTERFACE,
    member,
    path: PATH,
    ...args,
  });

const listen = (domicile: MiracastDesktop, member: string) =>
  domicile.dbus.match({
    bus: Bus.Session,
    interface: INTERFACE,
    member,
    path: PATH,
  });

/** The TVs the service lists now; none when it cannot be reached. */
const sinks = async (domicile: MiracastDesktop): Promise<CastTarget[]> =>
  (await call(domicile, "Sinks")).match({
    Err: () => [],
    Ok: ({ body }) => {
      const parsed = SINKS.safeParse(body);
      return parsed.success
        ? parsed.data[0].map(([id, name]) => ({
            id,
            mode: MIRACAST_MODE,
            name,
            unreachable: undefined,
          }))
        : [];
    },
  });

const watchSinks = async (
  domicile: MiracastDesktop,
  watch: Watch,
  listener: (targets: readonly CastTarget[]) => void,
): Promise<void> => {
  const tell = async () => {
    const listed = await sinks(domicile);
    if (!watch.stopped) {
      listener(listed);
    }
  };
  const matched = await listen(domicile, "SinksChanged");
  await tell();
  await matched.match({
    Err: () => Promise.resolve(),
    Ok: async (listening) => {
      watch.listening = listening;
      if (watch.stopped) {
        listening.stop();
      }
      const reader = listening.items.getReader();
      for (
        let next = await reader.read();
        !next.done;
        next = await reader.read()
      ) {
        await tell();
      }
    },
  });
};

/** The service's `Started` and `Ended`, heard for one cast. */
type CastSignals = {
  started: Listening<Listened<DbusSignal>>;
  ended: Listening<Listened<DbusSignal>>;
};

const UNAVAILABLE = "Miracast isn't available on this computer";

/**
 * Why a call failed, in words to show: a D-Bus error's message without its
 * name, or that the service is not installed.
 */
const reason = ({ message }: SystemError): string =>
  message.startsWith("org.freedesktop.DBus.Error.ServiceUnknown")
    ? UNAVAILABLE
    : message.replace(/^[\w.]+: /, "");

/** Listens for `Started` and `Ended`, before the cast, so neither is missed. */
const castSignals = async (
  domicile: MiracastDesktop,
): Promise<Result<CastSignals, string>> =>
  (await listen(domicile, "Started")).match({
    Err: () => Promise.resolve(Err<CastSignals, string>(UNAVAILABLE)),
    Ok: async (started) =>
      (await listen(domicile, "Ended")).match({
        Err: () => {
          started.stop();
          return Err<CastSignals, string>(UNAVAILABLE);
        },
        Ok: (ended) => Ok<CastSignals, string>({ ended, started }),
      }),
  });

/**
 * Starts a cast: resolves once the TV plays, or with why it never did.
 * `Ended` for the cast settles {@link Sending.ended}.
 */
const send = async (
  domicile: MiracastDesktop,
  targetId: string,
): Promise<Result<Sending, string>> =>
  (await castSignals(domicile)).andThenAsync(async (signals) =>
    (await call(domicile, "Cast", { body: [targetId], signature: "s" }))
      .mapErr(reason)
      .andThen(({ body }) => {
        const parsed = CAST.safeParse(body);
        return parsed.success
          ? Ok<string, string>(parsed.data[0])
          : Err<string, string>(UNAVAILABLE);
      })
      .match({
        Err: (why) => {
          signals.started.stop();
          signals.ended.stop();
          return Promise.resolve(Err<Sending, string>(why));
        },
        Ok: (id) => playing(domicile, signals, id),
      }),
  );

/** Cast `id`, once the TV plays it. */
const playing = async (
  domicile: MiracastDesktop,
  signals: CastSignals,
  id: string,
): Promise<Result<Sending, string>> => {
  const ended = endOf(signals.ended, id).finally(() => {
    signals.ended.stop();
  });
  const outcome = await Promise.race([
    startOf(signals.started, id).then(() => Ok<"started", string>("started")),
    ended.then((reason) =>
      Err<"started", string>(reason || "The TV stopped the cast"),
    ),
  ]);
  signals.started.stop();
  return outcome.map(() => ({
    ended: ended.then(() => undefined),
    stop: () => {
      void call(domicile, "Stop", { body: [id], signature: "s" });
    },
  }));
};

/** Settles when `Started` names `id`. */
const startOf = async (
  listening: Listening<Listened<DbusSignal>>,
  id: string,
): Promise<void> => {
  const reader = listening.items.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (
      next.value.kind === ListenedKind.Heard &&
      CAST.safeParse(next.value.item.body).data?.[0] === id
    ) {
      return;
    }
  }
  return new Promise(() => {
    /* never: the listening stopped */
  });
};

/** The reason `Ended` gives for `id`; empty when it ended as asked. */
const endOf = async (
  listening: Listening<Listened<DbusSignal>>,
  id: string,
): Promise<string> => {
  const reader = listening.items.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (next.value.kind === ListenedKind.Heard) {
      const parsed = ENDED.safeParse(next.value.item.body);
      if (parsed.data?.[0] === id) {
        return parsed.data[1];
      }
    }
  }
  return "";
};
