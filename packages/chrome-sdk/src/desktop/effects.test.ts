import { describe, expect, it } from "bun:test";
import { Err, None, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";
import type { EffectsHost, ImageLoader, LoadedImage } from "./effects";
import { effects } from "./effects";

const SKSL = "uniform shader content; uniform float2 size; …";
const VERTEX = "Varyings main(const Attributes a) { … }";

const NOISE: LoadedImage = {
  height: 1,
  pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  width: 2,
};

/** Lets every promise the shell started settle. */
const settled = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A loader that knows only `noise.png`. */
const loader: ImageLoader = (url) =>
  url === "noise.png"
    ? Promise.resolve(NOISE)
    : Promise.reject(new Error(`404 ${url}`));

/** A host whose `registerShaderEffect` settles as `reply` says. */
const replying = (
  reply: Promise<number>,
  update: EffectsHost["updateShaderEffect"] = () => undefined,
): EffectsHost => {
  const { host } = new FakeDomicileHost();
  return {
    addEventListener: host.addEventListener.bind(host),
    registerShaderEffect: () => reply,
    removeEventListener: host.removeEventListener.bind(host),
    updateShaderEffect: update,
  };
};

const registered = async (host: EffectsHost) => {
  const result = await effects(host, loader).register("ripple", {
    sksl: SKSL,
  });
  return result.unwrapOrElse((error) => {
    throw new Error(error);
  });
};

describe("effects", () => {
  it("registers an effect with no outset unless it says one", async () => {
    const fake = new FakeDomicileHost();
    const { effects: shell } = desktop(fake.host);
    void shell.register("ripple", { sksl: SKSL });
    void shell.register("glow", { outset: 12, sksl: SKSL });
    await settled();

    expect(fake.calls).toStrictEqual([
      [
        "registerShaderEffect",
        "ripple",
        { images: [], outset: 0, screenOutset: false, sksl: SKSL },
      ],
      [
        "registerShaderEffect",
        "glow",
        { images: [], outset: 12, screenOutset: false, sksl: SKSL },
      ],
    ]);
  });

  it("lets an effect draw as far as the screen", async () => {
    const fake = new FakeDomicileHost();
    void effects(fake.host, loader).register("shatter", {
      outset: "screen",
      sksl: SKSL,
    });
    await settled();

    expect(fake.calls).toStrictEqual([
      [
        "registerShaderEffect",
        "shatter",
        { images: [], outset: 0, screenOutset: true, sksl: SKSL },
      ],
    ]);
  });

  it("draws a mesh effect over a grid or over instances", async () => {
    const fake = new FakeDomicileHost();
    const shell = effects(fake.host, loader);
    void shell.register("genie", {
      mesh: { grid: [16, 8] },
      sksl: SKSL,
      vertex: VERTEX,
    });
    void shell.register("shards", {
      mesh: { instances: 64 },
      sksl: SKSL,
      vertex: VERTEX,
    });
    await settled();

    expect(fake.calls).toStrictEqual([
      [
        "registerShaderEffect",
        "genie",
        {
          columns: 16,
          images: [],
          outset: 0,
          rows: 8,
          screenOutset: false,
          sksl: SKSL,
          vertex: VERTEX,
        },
      ],
      [
        "registerShaderEffect",
        "shards",
        {
          images: [],
          instances: 64,
          outset: 0,
          screenOutset: false,
          sksl: SKSL,
          vertex: VERTEX,
        },
      ],
    ]);
  });

  it("sends the images it samples, decoded", async () => {
    const fake = new FakeDomicileHost();
    void effects(fake.host, loader).register("dissolve", {
      images: { noise: "noise.png" },
      sksl: SKSL,
    });
    await settled();

    expect(fake.calls).toStrictEqual([
      [
        "registerShaderEffect",
        "dissolve",
        {
          images: [{ name: "noise", ...NOISE }],
          outset: 0,
          screenOutset: false,
          sksl: SKSL,
        },
      ],
    ]);
  });

  it("says which image did not load, and registers nothing", async () => {
    const fake = new FakeDomicileHost();

    expect(
      await effects(fake.host, loader).register("dissolve", {
        images: { noise: "missing.png" },
        sksl: SKSL,
      }),
    ).toStrictEqual(Err("image noise: 404 missing.png"));
    expect(fake.calls).toStrictEqual([]);
  });

  it("resolves how many numbers the effect takes", async () => {
    expect((await registered(replying(Promise.resolve(3)))).arguments).toBe(3);
  });

  it("says why the compiler refused it", async () => {
    const refused = Promise.reject(new Error("error: 1: expected ';'"));

    expect(
      await effects(replying(refused), loader).register("ripple", {
        sksl: SKSL,
      }),
    ).toStrictEqual(Err("error: 1: expected ';'"));
  });

  it("sets an element's arrays", async () => {
    const updates: unknown[][] = [];
    const effect = await registered(
      replying(Promise.resolve(0), (...args) => {
        updates.push(args);
      }),
    );
    const element = {} as Element;
    const points = new Float32Array([1, 2]);
    const sizes = new Float32Array([3]);

    expect(effect.update(element, { points, sizes })).toStrictEqual(None());
    expect(updates).toStrictEqual([
      [element, "ripple", "points", points],
      [element, "ripple", "sizes", sizes],
    ]);
  });

  it("says why it could not set an array", async () => {
    const effect = await registered(
      replying(Promise.resolve(0), () => {
        throw new RangeError("array points holds 8 floats, not 9");
      }),
    );

    expect(
      effect.update({} as Element, { points: new Float32Array(9) }),
    ).toStrictEqual(Some("array points holds 8 floats, not 9"));
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
