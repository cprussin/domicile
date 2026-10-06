/** Bytes in one little-endian `f32` sample. */
const SAMPLE = 4;

/**
 * The loudest of the `f32` samples in `carried` then `read`, clipped to 1.
 * `rest` is a trailing partial sample, to pass as `carried` with the next read.
 */
export const peak = (
  carried: Uint8Array,
  read: Uint8Array,
): { loudest: number; rest: Uint8Array } => {
  const bytes = new Uint8Array([...carried, ...read]);
  const whole = bytes.length - (bytes.length % SAMPLE);
  const view = new DataView(bytes.buffer, 0, whole);
  const samples = Array.from({ length: whole / SAMPLE }, (_, at) =>
    Math.abs(view.getFloat32(at * SAMPLE, true)),
  );
  return {
    loudest: Math.min(1, Math.max(0, ...samples)),
    rest: bytes.slice(whole),
  };
};
