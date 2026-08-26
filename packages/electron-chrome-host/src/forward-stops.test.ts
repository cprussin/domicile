import { describe, expect, it } from "bun:test";

import { forwardStops } from "./forward-stops";

/** A stand-in for `process`, so a test never signals its own runner. */
const signals = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    off: (signal: string, listener: () => void) => {
      listeners.get(signal)?.delete(listener);
    },
    on: (signal: string, listener: () => void) => {
      const set = listeners.get(signal) ?? new Set();
      set.add(listener);
      listeners.set(signal, set);
    },
    raise: (signal: string) => {
      for (const listener of listeners.get(signal) ?? []) {
        listener();
      }
    },
    watching: (signal: string) => listeners.get(signal)?.size ?? 0,
  };
};

/** A grace that fires only when the test says so. */
const heldGrace = () => {
  const pending: (() => void)[] = [];
  return {
    elapse: () => {
      for (const end of pending.splice(0)) {
        end();
      }
    },
    grace: (end: () => void) => {
      pending.push(end);
      return () => {
        const at = pending.indexOf(end);
        if (at !== -1) {
          pending.splice(at, 1);
        }
      };
    },
    pending: () => pending.length,
  };
};

const target = () => {
  const seen: string[] = [];
  return {
    end: () => {
      seen.push("end");
    },
    seen,
    signal: (signal: NodeJS.Signals) => {
      seen.push(signal);
    },
  };
};

describe("forwardStops", () => {
  it("passes every stop a desktop is ended with", () => {
    const source = signals();
    const to = target();
    forwardStops(to, heldGrace().grace, source);

    source.raise("SIGHUP");
    source.raise("SIGINT");
    source.raise("SIGTERM");

    expect(to.seen).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
  });

  it("ends a target that did not go", () => {
    // The reason this exists: handling a signal takes away Node's default
    // terminate, so a chrome wedged in its GPU process would otherwise make
    // the launcher immune to INT, TERM and HUP alike.
    const source = signals();
    const to = target();
    const held = heldGrace();
    forwardStops(to, held.grace, source);

    source.raise("SIGTERM");
    expect(to.seen).toEqual(["SIGTERM"]);
    held.elapse();

    expect(to.seen).toEqual(["SIGTERM", "end"]);
  });

  it("stops watching, and disarms, once released", () => {
    // A timer still armed after the target is gone fires at a process that
    // has exited — and, referenced, would hold the launcher open until it did.
    const source = signals();
    const to = target();
    const held = heldGrace();
    const release = forwardStops(to, held.grace, source);
    source.raise("SIGTERM");

    release();

    expect(source.watching("SIGTERM")).toBe(0);
    expect(held.pending()).toBe(0);
    held.elapse();
    expect(to.seen).toEqual(["SIGTERM"]);
  });
});
