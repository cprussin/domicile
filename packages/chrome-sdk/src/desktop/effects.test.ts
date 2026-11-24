import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";
import type { EffectsHost } from "./effects";
import { effects } from "./effects";

const SKSL = "uniform shader content; uniform float2 size; …";

/** A host whose `registerShaderEffect` settles as `reply` says. */
const replying = (reply: Promise<number>): EffectsHost => {
  const { host } = new FakeDomicileHost();
  return {
    addEventListener: host.addEventListener.bind(host),
    registerShaderEffect: () => reply,
    removeEventListener: host.removeEventListener.bind(host),
  };
};

describe("effects", () => {
  it("registers an effect with no outset unless it says one", () => {
    const fake = new FakeDomicileHost();
    const { effects: shell } = desktop(fake.host);
    void shell.register("ripple", { sksl: SKSL });
    void shell.register("glow", { outset: 12, sksl: SKSL });

    expect(fake.calls).toStrictEqual([
      ["registerShaderEffect", "ripple", SKSL, 0],
      ["registerShaderEffect", "glow", SKSL, 12],
    ]);
  });

  it("resolves how many numbers the effect takes", async () => {
    expect(
      await effects(replying(Promise.resolve(3))).register("ripple", {
        sksl: SKSL,
      }),
    ).toStrictEqual(Ok(3));
  });

  it("says why the compiler refused it", async () => {
    const refused = Promise.reject(new Error("error: 1: expected ';'"));

    expect(
      await effects(replying(refused)).register("ripple", { sksl: SKSL }),
    ).toStrictEqual(Err("error: 1: expected ';'"));
  });

  it("names the effect a GPU hang dropped", () => {
    const fake = new FakeDomicileHost();
    const heard: string[] = [];
    const stop = desktop(fake.host).effects.on("lost", (name) => {
      heard.push(name);
    });
    fake.dispatch("shadereffectlost", { data: "ripple" });
    stop();
    fake.dispatch("shadereffectlost", { data: "glow" });

    expect(heard).toEqual(["ripple"]);
  });
});
