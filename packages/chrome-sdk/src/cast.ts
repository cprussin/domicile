// Casting to TVs for a shell: the TVs each backend finds, and the casts the
// user started. See docs/CASTING-TO-TVS.md.
//
// A backend sends a picture it asks the ScreenCast portal for. To extend the
// desk, the shell adds a virtual monitor and answers that request with it
// itself; to cast something else, the share picker asks, titled for the TV.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { Displays } from "./desktop/displays";
import type { GoogleCast } from "./desktop/google-cast";
import type { CastSource, PortalAnswer, PortalRequest } from "./portal";
import { PortalAnswer as Answer, CastSourceKind, PortalKind } from "./portal";
import type { VirtualMonitorMode } from "./system";

/** A TV a backend found. */
export type CastTarget = {
  /** Its id within its backend. */
  id: string;
  /** What the TV calls itself. */
  name: string;
  /**
   * Why it cannot be cast to now, such as "Needs Wi-Fi Direct", or
   * `undefined` when it can.
   */
  unreachable: string | undefined;
  /** The mode it shows best, which an extended desk takes. */
  mode: Omit<VirtualMonitorMode, "name">;
};

/** A picture going to a TV. */
export type Sending = {
  stop: () => void;
  /** Settles once it stopped, whoever stopped it. */
  ended: Promise<void>;
};

/** Something that sends to TVs: the engine's Google Cast, or Miracast. */
export type CastBackend = {
  /**
   * The app id its ScreenCast portal requests carry, or `undefined` when it
   * is not known: then a cast claims the next request from any app.
   */
  appId: string | undefined;
  /** Calls `listener` with every TV it finds now, and on each change. */
  watchTargets: (
    listener: (targets: readonly CastTarget[]) => void,
  ) => () => void;
  /**
   * Starts sending to the TV `targetId`, asking the ScreenCast portal for the
   * picture. `Err` says why the TV refused, in words to show.
   */
  send: (targetId: string) => Promise<Result<Sending, string>>;
};

export enum CastMode {
  /** The TV becomes a monitor the desk extends onto. */
  Extend,
  /** The share picker asks what to show. */
  Pick,
}

/** A running cast. */
export type Cast = {
  backend: CastBackend;
  target: CastTarget;
  mode: CastMode;
  stop: () => void;
};

export enum CastClaimKind {
  /** Answer it with `answer`, showing nothing. */
  Answered,
  /** Show the share picker, titled for the TV `to`. */
  Pick,
}

/** What the shell does with a ScreenCast request a cast asked for. */
export type CastClaim =
  | { kind: CastClaimKind.Answered; answer: PortalAnswer }
  | { kind: CastClaimKind.Pick; to: string };

/** The casts on a desktop. */
export type Casting = {
  /** Casts to `target` from `backend`, once the TV takes it. */
  start: (
    backend: CastBackend,
    target: CastTarget,
    mode: CastMode,
  ) => Promise<Result<Cast, string>>;
  /** Calls `listener` with every running cast now, and on each change. */
  watch: (listener: (casts: readonly Cast[]) => void) => () => void;
};

/** What {@link casting} needs of the desktop. */
export type CastDesktop = {
  readonly displays: Pick<Displays, "addVirtual" | "list" | "on">;
};

/** A ScreenCast request a started cast waits on. */
type Waiting = {
  appId: string | undefined;
  claim: (
    request: Extract<PortalRequest, { kind: PortalKind.ScreenCast }>,
  ) => CastClaim;
};

/** One desktop's casts and the requests they wait on. */
type Desk = Casting & { awaited: Waiting[] };

const desks = new WeakMap<object, Desk>();

/**
 * The casts on `domicile`. Every caller with the same desktop shares them, so
 * the bar and the portal dialogs see the same casts. `monitors`, for tests,
 * is the first caller's.
 */
export const casting = (
  domicile: CastDesktop,
  monitors: Pick<Displays, "addVirtual"> = domicile.displays,
): Casting => {
  const known = desks.get(domicile);
  if (known === undefined) {
    const desk = deskOf(domicile, monitors);
    desks.set(domicile, desk);
    return desk;
  } else {
    return known;
  }
};

/**
 * What the shell does with `request` on `domicile`: `undefined` when no cast
 * asked for it, so it is an application's. Each cast claims one request.
 */
export const claimCastRequest = (
  domicile: object,
  request: PortalRequest,
): CastClaim | undefined => {
  const desk = desks.get(domicile);
  if (desk === undefined || request.kind !== PortalKind.ScreenCast) {
    return undefined;
  }
  const index = desk.awaited.findIndex(
    (awaited) => awaited.appId === undefined || awaited.appId === request.appId,
  );
  if (index === -1) {
    return undefined;
  }
  const [awaited] = desk.awaited.splice(index, 1);
  return awaited?.claim(request);
};

/**
 * The mode an extended desk takes on a Google Cast TV: the Cast mirroring
 * service sends at most 1080p.
 */
const GOOGLE_CAST_MODE = { height: 1080, refreshMhz: 60_000, width: 1920 };

/** The engine's Google Cast, as a backend: `domicile.googleCast`. */
export const engineCast = (cast: GoogleCast): CastBackend => ({
  // The browser's own capture asks the portal, under an app id it does not
  // choose.
  appId: undefined,
  send: async (targetId) =>
    (await cast.cast(targetId)).map((route) => sendingTo(cast, route)),
  watchTargets: (listener) => {
    const send = () => {
      listener(
        cast.receivers.map(({ id, name }) => ({
          id,
          mode: GOOGLE_CAST_MODE,
          name,
          unreachable: undefined,
        })),
      );
    };
    const unsubscribe = cast.on("change", send);
    send();
    return unsubscribe;
  },
});

/**
 * Route `route` from {@link engineCast}. The list can name it before or after
 * the cast resolves, so it ends when a list without it follows one with it,
 * or follows a stop.
 */
const sendingTo = (cast: GoogleCast, route: string): Sending => {
  const listed = () => cast.receivers.some((tv) => tv.route === route);
  const { promise: ended, resolve } = Promise.withResolvers<void>();
  const seen = { stopped: false, value: listed() };
  const unsubscribe = cast.on("change", () => {
    if (listed()) {
      seen.value = true;
    } else if (seen.value || seen.stopped) {
      unsubscribe();
      resolve();
    }
  });
  return {
    ended,
    stop: () => {
      seen.stopped = true;
      cast.stop(route);
    },
  };
};

const deskOf = (
  domicile: CastDesktop,
  monitors: Pick<Displays, "addVirtual">,
): Desk => {
  const awaited: Waiting[] = [];
  let casts: readonly Cast[] = [];
  const listeners = new Set<(casts: readonly Cast[]) => void>();
  const set = (next: readonly Cast[]) => {
    casts = next;
    for (const listener of listeners) {
      listener(casts);
    }
  };
  const forget = (waiting: Waiting) => {
    const index = awaited.indexOf(waiting);
    if (index !== -1) {
      awaited.splice(index, 1);
    }
  };

  /** Sends `target` what `waiting` answers, then lists the cast. */
  const send = async (
    backend: CastBackend,
    target: CastTarget,
    mode: CastMode,
    waiting: Waiting,
    done: () => void,
  ): Promise<Result<Cast, string>> => {
    awaited.push(waiting);
    const sent = await backend.send(target.id);
    return sent.match({
      Err: (refused) => {
        forget(waiting);
        done();
        return Err(refused);
      },
      Ok: (sending) => {
        const cast: Cast = { backend, mode, stop: sending.stop, target };
        set([...casts, cast]);
        void sending.ended.then(() => {
          forget(waiting);
          done();
          set(casts.filter((running) => running !== cast));
        });
        return Ok(cast);
      },
    });
  };

  return {
    awaited,
    start: async (backend, target, mode) => {
      switch (mode) {
        case CastMode.Pick: {
          return send(
            backend,
            target,
            mode,
            {
              appId: backend.appId,
              claim: () => ({ kind: CastClaimKind.Pick, to: target.name }),
            },
            () => undefined,
          );
        }
        case CastMode.Extend: {
          const added = await monitors.addVirtual({
            ...target.mode,
            name: target.name,
          });
          return added
            .mapErr((error) => error.message)
            .andThenAsync(async (monitor) => {
              if (!(await shown(domicile, monitor.output, monitor.ended))) {
                return Err(`${target.name} went away before it was shown`);
              }
              const started = await send(
                backend,
                target,
                mode,
                {
                  appId: backend.appId,
                  claim: (request) =>
                    answerWith(request.body.sources, monitor.output),
                },
                monitor.remove,
              );
              // The monitor went with its compositor: stop sending it.
              void monitor.ended.then((ended) => {
                if (ended.isErr()) {
                  started.match({
                    Err: () => undefined,
                    Ok: (cast) => {
                      cast.stop();
                    },
                  });
                }
              });
              return started;
            });
        }
      }
    },
    watch: (listener) => {
      listeners.add(listener);
      listener(casts);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** The monitor `output` among `sources`, or a cancel when it is not one. */
const answerWith = (
  sources: readonly CastSource[],
  output: string,
): CastClaim => {
  const source = sources.find(
    (offered) =>
      offered.kind === CastSourceKind.Monitor && offered.name === output,
  );
  return {
    answer:
      source === undefined ? Answer.Canceled() : Answer.ScreenCast([source]),
    kind: CastClaimKind.Answered,
  };
};

/**
 * Whether `output` is among the desktop's displays, now or once the compositor
 * says so, rather than `ended` first.
 */
const shown = (
  { displays }: CastDesktop,
  output: string,
  ended: Promise<unknown>,
): Promise<boolean> =>
  new Promise((resolve) => {
    const check = () => {
      if (displays.list?.some((display) => display.name === output)) {
        stop();
        resolve(true);
      }
    };
    const stop = displays.on("change", check);
    void ended.then(() => {
      stop();
      resolve(false);
    });
    check();
  });
