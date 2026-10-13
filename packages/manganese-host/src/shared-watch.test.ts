import { describe, expect, it } from "bun:test";

import { sharedWatch } from "./shared-watch";

/** A watch the test drives: `send` reports a value, and it counts starts and stops. */
const heldWatch = () => {
  const counts = { started: 0, stopped: 0 };
  const senders: ((value: number) => void)[] = [];
  const watch = sharedWatch((onValue: (value: number) => void) => {
    counts.started += 1;
    senders.push(onValue);
    return () => {
      counts.stopped += 1;
    };
  });
  return {
    counts,
    /** Reports `value` from the watch started `nth` (0 is the first). */
    send: (value: number, nth = senders.length - 1) => {
      senders[nth]?.(value);
    },
    watch,
  };
};

describe("sharedWatch", () => {
  it("starts one watch for every subscriber, and tells each of every value", () => {
    const { counts, send, watch } = heldWatch();
    const heard = { a: 0, b: 0 };

    watch.subscribe(() => {
      heard.a += 1;
    });
    watch.subscribe(() => {
      heard.b += 1;
    });
    send(1);

    expect(counts.started).toBe(1);
    expect(heard).toEqual({ a: 1, b: 1 });
    expect(watch.current()).toBe(1);
  });

  it("starts nothing until the first subscriber", () => {
    const { counts, watch } = heldWatch();

    expect(counts.started).toBe(0);
    expect(watch.current()).toBeUndefined();
  });

  it("stops the watch when the last subscriber leaves, and not before", () => {
    const { counts, watch } = heldWatch();
    const leaveA = watch.subscribe(() => undefined);
    const leaveB = watch.subscribe(() => undefined);

    leaveA();
    expect(counts.stopped).toBe(0);

    leaveB();
    expect(counts.stopped).toBe(1);
  });

  it("has the current value for a subscriber that comes late", () => {
    const { send, watch } = heldWatch();
    watch.subscribe(() => undefined);
    send(7);

    const heard: (number | undefined)[] = [];
    watch.subscribe(() => {
      heard.push(watch.current());
    });

    expect(watch.current()).toBe(7);
    send(8);
    expect(heard).toEqual([8]);
  });

  it("starts again for a subscriber after the last left, without the old value", () => {
    const { counts, send, watch } = heldWatch();
    const leave = watch.subscribe(() => undefined);
    send(3);
    leave();

    watch.subscribe(() => undefined);

    expect(counts.started).toBe(2);
    expect(watch.current()).toBeUndefined();
  });

  it("drops a value a stopped watch sends late", () => {
    // `hostBacklight` stops only once `udevadm` has started, so a reading can
    // follow the stop.
    const { send, watch } = heldWatch();
    watch.subscribe(() => undefined)();
    watch.subscribe(() => undefined);

    send(5, 0);

    expect(watch.current()).toBeUndefined();
  });
});
