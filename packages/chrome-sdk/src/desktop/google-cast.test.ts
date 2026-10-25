import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";
import type { GoogleCastHost } from "./google-cast";
import { googleCast } from "./google-cast";

const TV = { id: "tv-1", name: "Living Room TV", route: null };

/** A host whose `startCasting` settles as `reply` says. */
const replying = (reply: Promise<string>): GoogleCastHost => {
  const { host } = new FakeDomicileHost();
  return {
    addEventListener: host.addEventListener.bind(host),
    castSinks: null,
    removeEventListener: host.removeEventListener.bind(host),
    startCasting: () => reply,
    stopCasting: () => undefined,
  };
};

describe("googleCast", () => {
  it("lists no TVs until the browser says", () => {
    const { googleCast: cast } = desktop(new FakeDomicileHost().host);

    expect(cast.receivers).toEqual([]);
  });

  it("lists the TVs, and says when they change", () => {
    const fake = new FakeDomicileHost();
    const { googleCast: cast } = desktop(fake.host);
    const heard: unknown[] = [];
    cast.on("change", () => {
      heard.push(cast.receivers);
    });
    fake.set({ castSinks: [TV] });

    expect(heard).toEqual([[TV]]);
  });

  it("casts to a TV and stops its route", () => {
    const fake = new FakeDomicileHost();
    const { googleCast: cast } = desktop(fake.host);
    void cast.cast("tv-1");
    cast.stop("route-1");

    expect(fake.calls).toStrictEqual([
      ["startCasting", "tv-1"],
      ["stopCasting", "route-1"],
    ]);
  });

  it("resolves the cast's route", async () => {
    expect(
      await googleCast(replying(Promise.resolve("route-1"))).cast("tv-1"),
    ).toStrictEqual(Ok("route-1"));
  });

  it("says why the TV refused", async () => {
    const refused = Promise.reject(new Error("The TV did not take the cast"));

    expect(await googleCast(replying(refused)).cast("tv-1")).toStrictEqual(
      Err("The TV did not take the cast"),
    );
  });
});
