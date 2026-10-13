import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Listening, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Battery } from "@domicile-desktop/system-battery/battery";

import { watchBattery } from "./watch-battery";

type Watched = Result<Listening<Option<Battery>>, SystemError>;

/**
 * A battery library that answers each watch with the next of `answers`, and
 * counts the watches it was asked for and stopped.
 */
const library = (...answers: Watched[]) => {
  const counts = { started: 0 };
  return {
    counts,
    watch: () => {
      const answer = answers[counts.started];
      counts.started += 1;
      if (answer === undefined) {
        throw new Error("test: watched more often than expected");
      } else {
        return Promise.resolve(answer);
      }
    },
  };
};

/** A watch whose readings are `readings` and whose stops are counted. */
const watching = (
  readings: readonly Option<Battery>[],
  ended: Promise<Result<"stopped", SystemError>> = new Promise(() => undefined),
) => {
  const stops = { count: 0 };
  const listening: Listening<Option<Battery>> = {
    ended,
    items: new ReadableStream({
      start: (controller) => {
        for (const reading of readings) {
          controller.enqueue(reading);
        }
      },
    }),
    stop: () => {
      stops.count += 1;
    },
  };
  return {
    answer: Ok<Listening<Option<Battery>>, SystemError>(listening),
    stops,
  };
};

const neverFails = (error: unknown) => {
  throw new Error(`test: the battery failed: ${String(error)}`);
};

/** Let the library's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchBattery", () => {
  it("reports each reading the library gives", async () => {
    const half = Some({ charge: 0.5, charging: false });
    const battery = library(watching([half, None()]).answer);
    const readings: Option<Battery>[] = [];

    await new Promise<void>((resolve) => {
      watchBattery(
        new FakeDomicileHost().host,
        (reading) => {
          readings.push(reading);
          if (readings.length === 2) {
            resolve();
          }
        },
        { fail: neverFails, watch: battery.watch },
      );
    });

    expect(readings).toStrictEqual([half, None()]);
  });

  it("stops the library's watch when stopped", async () => {
    const watch = watching([]);
    const stop = watchBattery(new FakeDomicileHost().host, () => undefined, {
      fail: neverFails,
      watch: library(watch.answer).watch,
    });
    await settle();

    stop();

    expect(watch.stops.count).toBe(1);
  });

  it("stops a watch that starts after it was stopped", async () => {
    const watch = watching([]);

    watchBattery(new FakeDomicileHost().host, () => undefined, {
      fail: neverFails,
      watch: library(watch.answer).watch,
    })();
    await settle();

    expect(watch.stops.count).toBe(1);
  });

  it("reports a failure to start, and a watch that breaks", async () => {
    const broken: SystemError = {
      kind: SystemErrorKind.Dbus,
      message: "org.freedesktop.DBus.Error.ServiceUnknown",
    };
    const failures: unknown[] = [];
    const battery = library(
      Err(broken),
      watching([], Promise.resolve(Err(broken))).answer,
    );

    for (let started = 0; started < 2; started += 1) {
      watchBattery(new FakeDomicileHost().host, () => undefined, {
        fail: (error) => failures.push(error),
        watch: battery.watch,
      });
    }
    await settle();

    expect(failures).toStrictEqual([broken, broken]);
  });
});
