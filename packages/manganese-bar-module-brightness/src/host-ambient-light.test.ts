import { describe, expect, it } from "bun:test";
import type { Option } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Listening, SystemError } from "@domicile-desktop/sdk/system";

import { hostAmbientLight } from "./host-ambient-light";

/** A sensor that reads `levels`, and counts its stops. */
const sensor = (...levels: number[]) => {
  const stops = { count: 0 };
  const watch = () =>
    Promise.resolve(
      Ok<Option<Listening<number>>, SystemError>(
        Some({
          ended: new Promise<never>(() => undefined),
          items: new ReadableStream<number>({
            start: (controller) => {
              for (const level of levels) {
                controller.enqueue(level);
              }
            },
          }),
          stop: () => {
            stops.count += 1;
          },
        }),
      ),
    );
  return { stops, watch };
};

describe("hostAmbientLight", () => {
  it("passes on each level the sensor reads", async () => {
    const { watch } = sensor(30, 900);
    const heard: number[] = [];

    await new Promise<void>((done) => {
      hostAmbientLight(
        new FakeDomicileHost().host,
        watch,
      )((lux) => {
        heard.push(lux);
        if (heard.length === 2) {
          done();
        }
      });
    });

    expect(heard).toEqual([30, 900]);
  });

  it("stops the sensor when the watch stops", async () => {
    const { stops, watch } = sensor(30);
    const first = Promise.withResolvers<void>();
    const stop = hostAmbientLight(
      new FakeDomicileHost().host,
      watch,
    )(() => {
      first.resolve();
    });
    await first.promise;

    stop();
    await new Promise((settled) => setTimeout(settled, 0));

    expect(stops.count).toBe(1);
  });

  it("hears nothing on a machine without a sensor", async () => {
    const heard: number[] = [];
    const stop = hostAmbientLight(new FakeDomicileHost().host, () =>
      Promise.resolve(Ok<Option<Listening<number>>, SystemError>(None())),
    )((lux) => {
      heard.push(lux);
    });
    await new Promise((settled) => setTimeout(settled, 0));
    stop();

    expect(heard).toEqual([]);
  });
});
