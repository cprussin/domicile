// The shell's shader effects: SkSL that the GPU process runs over an element
// as `filter: domicile-shader(name, …)` or `backdrop-filter`. See
// docs/architecture/MOTION.md.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";

import type {
  DomicileHost,
  DomicileShaderEffectImage,
  DomicileShaderEffectInit,
} from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/**
 * The mesh a mesh effect draws the element through: a grid of `columns` by
 * `rows` cells, or `instances` quads. At most 16384 cells or quads.
 */
export type ShaderEffectMesh =
  | { readonly grid: readonly [columns: number, rows: number] }
  | { readonly instances: number };

/** A shader effect's programs, and what else it draws with. */
export type ShaderEffect = {
  /**
   * Strict ES2 SkSL of at most 32 KiB. Its children are `uniform shader
   * content`, the element as drawn, and one for each of `images`. Its first
   * uniform is `uniform float2 size`, the element's size. `main`'s `p` runs
   * from the element's top left. Both are in device pixels, as a mesh
   * effect's `size` and varyings are, so pass `devicePixelRatio` as a number
   * to measure in CSS pixels. The uniforms after `size` are the numbers
   * `domicile-shader()` passes, in order, at most 16 floats in all, then any
   * arrays, which `update()` sets.
   *
   * A mesh effect's is a mesh fragment program instead:
   * `float2 main(const Varyings v, out half4 color)`.
   */
  readonly sksl: string;
  /**
   * A mesh effect's vertex program, `Varyings main(const Attributes a)`,
   * which places each vertex of `mesh`. See MOTION.md for its attributes
   * and varyings.
   */
  readonly vertex?: string;
  readonly mesh?: ShaderEffectMesh;
  /**
   * The images it samples, by the name of their `uniform shader`, at most
   * 4: URLs the shell can fetch, at most 2048 pixels on a side. Each
   * repeats across the element.
   */
  readonly images?: Readonly<Record<string, string>>;
  /**
   * How many CSS pixels it may draw outside the element, or "screen" for as
   * far as the screen's longer side. 0 by default.
   */
  readonly outset?: number | "screen";
};

/** A registered effect. */
export type RegisteredEffect = {
  /** How many numbers `domicile-shader()` passes it. */
  readonly arguments: number;
  /**
   * Sets the effect's array uniforms, by name, for `element`, which draws
   * them in its next frame. A shorter array leaves the rest zero. An
   * element's arrays hold at most 64 KiB. Returns why it could not, when
   * the effect has no such array or the values do not fit.
   */
  readonly update: (
    element: Element,
    arrays: Readonly<Record<string, Float32Array>>,
  ) => Option<string>;
};

/** An image's pixels: unpremultiplied RGBA, rows top first. */
export type LoadedImage = Omit<DomicileShaderEffectImage, "name">;

/** Fetches and decodes the image at `url`. */
export type ImageLoader = (url: string) => Promise<LoadedImage>;

export type EffectsListeners = {
  /**
   * The engine dropped effect `name`: the GPU process went while drawing
   * it, which a hung effect does. Its filters draw nothing until it is
   * registered again.
   */
  lost: (name: string) => void;
};

export type Effects = {
  /**
   * Compiles `effect` as `name`, which `domicile-shader(name, …)` then
   * draws, or says why not: the compiler's error, or an image that did not
   * load. A second register of `name` replaces the first. Throws for an
   * empty name or an outset that is negative or not finite.
   */
  register: (
    name: string,
    effect: ShaderEffect,
  ) => Promise<Result<RegisteredEffect, string>>;
  on: On<EffectsListeners>;
};

export type EffectsHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "registerShaderEffect"
  | "removeEventListener"
  | "updateShaderEffect"
>;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Decodes an image with the page's own decoders. */
export const decodeImage: ImageLoader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status.toString()} ${url}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: "none",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("no 2D canvas to decode with");
  }
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    height: bitmap.height,
    pixels: new Uint8Array(data.buffer),
    width: bitmap.width,
  };
};

/** Every image, loaded, or which one did not. */
const loadImages = async (
  images: Readonly<Record<string, string>>,
  load: ImageLoader,
): Promise<Result<DomicileShaderEffectImage[], string>> => {
  try {
    return Ok(
      await Promise.all(
        Object.entries(images).map(async ([name, url]) => {
          try {
            return { name, ...(await load(url)) };
          } catch (error: unknown) {
            throw new Error(`image ${name}: ${message(error)}`);
          }
        }),
      ),
    );
  } catch (error: unknown) {
    return Err(message(error));
  }
};

const meshInit = (
  mesh: ShaderEffectMesh | undefined,
): Partial<DomicileShaderEffectInit> => {
  if (mesh === undefined) {
    return {};
  } else if ("grid" in mesh) {
    return { columns: mesh.grid[0], rows: mesh.grid[1] };
  } else {
    return { instances: mesh.instances };
  }
};

export const effects = (
  host: EffectsHost,
  loadImage: ImageLoader = decodeImage,
): Effects => ({
  on: on<EffectsListeners>({
    lost: (listener) =>
      hostEvent(host, "shadereffectlost", (event) => listener(event.data)),
  }),
  register: async (name, { sksl, vertex, mesh, images = {}, outset = 0 }) =>
    (await loadImages(images, loadImage)).andThenAsync((loaded) =>
      host
        .registerShaderEffect(name, {
          images: loaded,
          outset: outset === "screen" ? 0 : outset,
          screenOutset: outset === "screen",
          sksl,
          ...(vertex === undefined ? {} : { vertex }),
          ...meshInit(mesh),
        })
        .then(
          (taken) =>
            Ok<RegisteredEffect, string>({
              arguments: taken,
              update: (element, arrays) => {
                try {
                  for (const [uniform, values] of Object.entries(arrays)) {
                    host.updateShaderEffect(element, name, uniform, values);
                  }
                  return None();
                } catch (error: unknown) {
                  return Some(message(error));
                }
              },
            }),
          (error: unknown) => Err<RegisteredEffect, string>(message(error)),
        ),
    ),
});
