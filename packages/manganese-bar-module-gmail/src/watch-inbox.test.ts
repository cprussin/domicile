import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";

import type { Inbox as InboxReading } from "./inbox";
import { Inbox } from "./inbox";
import { watchInbox } from "./watch-inbox";

/** A minute: how often the watch reads. */
const POLL_MS = 60_000;

/** Lets every settled read reach its listener. */
const settle = async () => {
  for (const _ of [1, 2, 3]) {
    await Promise.resolve();
  }
};

const neverFails = (error: unknown) => {
  throw new Error(`test: the watch failed: ${String(error)}`);
};

const notPaused = () => false;

const noAnswerLeft = () => Promise.reject(new Error("test: no answer left"));

/** A read that counts how often it ran and answers a total that many. */
const counting = () => {
  const reads = { count: 0 };
  return {
    read: () => {
      reads.count += 1;
      return Promise.resolve(Inbox.Counted(reads.count, 0));
    },
    reads,
  };
};

describe("watchInbox", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reads now and again every poll", async () => {
    const { read } = counting();
    const seen: InboxReading[] = [];

    const stop = watchInbox(
      read,
      (inbox) => seen.push(inbox),
      notPaused,
      neverFails,
    );
    await settle();
    jest.advanceTimersByTime(POLL_MS);
    await settle();
    stop();

    expect(seen).toStrictEqual([Inbox.Counted(1, 0), Inbox.Counted(2, 0)]);
  });

  it("reads nothing while paused", async () => {
    const { read, reads } = counting();
    const paused = { now: true };

    const stop = watchInbox(
      read,
      () => undefined,
      () => paused.now,
      neverFails,
    );
    jest.advanceTimersByTime(POLL_MS);
    paused.now = false;
    jest.advanceTimersByTime(POLL_MS);
    await settle();
    stop();

    expect(reads.count).toBe(1);
  });

  it("reports a failed read and reads again at the next poll", async () => {
    const failures: unknown[] = [];
    const answers = [
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(Inbox.SignedOut()),
    ];
    const seen: InboxReading[] = [];

    const stop = watchInbox(
      () => (answers.shift() ?? noAnswerLeft)(),
      (inbox) => seen.push(inbox),
      notPaused,
      (error) => failures.push(error),
    );
    await settle();
    jest.advanceTimersByTime(POLL_MS);
    await settle();
    stop();

    expect(failures).toStrictEqual([new Error("offline")]);
    expect(seen).toStrictEqual([Inbox.SignedOut()]);
  });

  it("stops reading, and drops an answer that arrives after", async () => {
    const { read, reads } = counting();
    const seen: InboxReading[] = [];

    const stop = watchInbox(
      read,
      (inbox) => seen.push(inbox),
      notPaused,
      neverFails,
    );
    stop();
    await settle();
    jest.advanceTimersByTime(POLL_MS * 2);

    expect(reads.count).toBe(1);
    expect(seen).toStrictEqual([]);
  });
});
