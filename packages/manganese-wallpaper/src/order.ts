// The order a rotation shows its photographs in, pass by pass.

/**
 * The order of `photos` on pass `pass` through them. Pure, so a pass reads the
 * same on every render.
 */
export type Order = (
  photos: readonly string[],
  pass: number,
) => readonly string[];

/** The photographs as given, every pass. */
export const inOrder: Order = (photos) => photos;

/**
 * A fresh shuffle of the photographs each pass, from `seed`. A pass never
 * starts on the photograph the last one ended on. Two photographs or fewer
 * keep their order, since they can only alternate.
 */
export const shuffledOrder =
  (seed: number): Order =>
  (photos, pass) => {
    if (photos.length < 3) {
      return photos;
    }
    const order = shuffle(photos, seed, pass);
    // Only the first two can swap, so the last pass's last is its shuffle's.
    if (pass > 0 && order[0] === shuffle(photos, seed, pass - 1).at(-1)) {
      swap(order, 0, 1);
    }
    return order;
  };

/** `photos` shuffled by Fisher–Yates, seeded by `seed` and `pass`. */
const shuffle = (
  photos: readonly string[],
  seed: number,
  pass: number,
): string[] => {
  const random = mulberry32(seed ^ Math.imul(pass + 1, 0x9e_37_79_b9));
  const order = [...photos];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    swap(order, index, other);
  }
  return order;
};

/** Swaps the photographs at `first` and `second` in `order`. */
const swap = (order: string[], first: number, second: number) => {
  const atFirst = order[first];
  const atSecond = order[second];
  if (atFirst === undefined || atSecond === undefined) {
    throw new Error("cannot swap a photograph past the end of the order");
  }
  order[first] = atSecond;
  order[second] = atFirst;
};

/** A small seeded generator of numbers in [0, 1). */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};
