// The agent seats: agents driving their own pointer and keyboard beside the
// user's. See docs/architecture/AGENT-SEATS.md.

import type { DomicileHost, DomicileSeat } from "../domicile-host";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** An agent's seat. */
export type Seat = {
  /** `agent-<session>`; what {@link ClientWindow.heldBy} names. */
  readonly id: string;
  /** The agent's name, as it asked to be let in. */
  readonly name: string;
  /**
   * Where its pointer is, in desk coordinates (those of
   * `domicile.displays`); `undefined` before it first points.
   */
  readonly pointer: { readonly x: number; readonly y: number } | undefined;
  /** The window its keyboard is in. */
  readonly focused: string | undefined;
  /** The windows it holds: the one its keyboard is in and the one its pointer is in. */
  readonly holds: readonly string[];
  /** The windows the user took from it, which it can't drive until given back. */
  readonly taken: readonly string[];
};

export type SeatsListeners = {
  /** A seat came, went, moved its pointer or focus, or a window was taken or given back. */
  change: () => void;
};

export type Seats = {
  /** Every agent seat; `undefined` until the compositor says. The user's own seat isn't listed. */
  readonly list: readonly Seat[] | undefined;
  /**
   * Take window `appId` from the agent holding it, as the user's click or key
   * in it does. The agent can't drive it until {@link Seats.giveBack}.
   */
  takeOver: (appId: string) => void;
  /** Let agents drive window `appId` again. */
  giveBack: (appId: string) => void;
  on: On<SeatsListeners>;
};

export type SeatsHost = Pick<
  DomicileHost,
  "addEventListener" | "giveBack" | "removeEventListener" | "seats" | "takeOver"
>;

export const seats = (host: SeatsHost): Seats => {
  const listOf = memoizeLast((list: readonly DomicileSeat[] | null) =>
    list?.map(seatOf),
  );
  return {
    giveBack: (appId) => {
      host.giveBack(appId);
    },
    get list() {
      return listOf(host.seats);
    },
    on: on<SeatsListeners>({
      change: (listener) => hostEvent(host, "seatschanged", () => listener()),
    }),
    takeOver: (appId) => {
      host.takeOver(appId);
    },
  };
};

const seatOf = (seat: DomicileSeat): Seat => ({
  focused: seat.focused ?? undefined,
  holds: seat.holds,
  id: seat.id,
  name: seat.name,
  pointer:
    seat.pointerX === null || seat.pointerY === null
      ? undefined
      : { x: seat.pointerX, y: seat.pointerY },
  taken: seat.taken,
});
