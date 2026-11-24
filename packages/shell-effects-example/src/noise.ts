// The smoke's noise image: smooth value noise that tiles, a different field
// in each of red, green and blue. The effect samples it as `uniform shader
// noise`, and the engine repeats it across the screen.

/** Lattice cells across the image, at the coarser of its two octaves. */
const CELLS = 8;

/** Pixels on a side of the image the shell registers. */
const NOISE_SIDE = 256;

/** The noise as opaque RGBA pixels, `side` square, rows top first. */
export const noisePixels = (side: number): Uint8ClampedArray<ArrayBuffer> =>
  Uint8ClampedArray.from({ length: side * side * 4 }, (_, index) => {
    const channel = index % 4;
    const pixel = Math.floor(index / 4);
    const u = ((pixel % side) / side) * CELLS;
    const v = (Math.floor(pixel / side) / side) * CELLS;
    return channel === 3
      ? 255
      : Math.round(
          (255 *
            (valueNoise(u, v, CELLS, channel) +
              0.5 * valueNoise(u * 2, v * 2, CELLS * 2, channel))) /
            1.5,
        );
  });

/** The noise as a PNG at a URL this page can fetch, for `images`. */
export const noiseUrl = async (): Promise<string> => {
  const canvas = new OffscreenCanvas(NOISE_SIDE, NOISE_SIDE);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("no 2D canvas to draw the noise with");
  } else {
    context.putImageData(
      new ImageData(noisePixels(NOISE_SIDE), NOISE_SIDE),
      0,
      0,
    );
    return URL.createObjectURL(
      await canvas.convertToBlob({ type: "image/png" }),
    );
  }
};

/** Noise from 0 to 1 at (`u`, `v`), repeating every `cells` cells. */
const valueNoise = (
  u: number,
  v: number,
  cells: number,
  channel: number,
): number => {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const fx = smooth(u - x);
  const fy = smooth(v - y);
  const at = (dx: number, dy: number) =>
    lattice((x + dx) % cells, (y + dy) % cells, channel);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
  return top + (bottom - top) * fy;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** A fixed value from 0 to 1 for each lattice point and channel. */
const lattice = (x: number, y: number, channel: number): number => {
  const mixed =
    Math.imul(x, 374_761_393) ^
    Math.imul(y, 668_265_263) ^
    Math.imul(channel + 1, 2_147_483_647);
  const hashed = Math.imul(mixed ^ (mixed >>> 13), 1_274_126_177);
  return ((hashed ^ (hashed >>> 16)) >>> 0) / 4_294_967_295;
};
