// The host↔chrome socket is framed as newline-delimited JSON, but a stream
// chunk boundary lands anywhere — mid-frame, or across several frames. This
// splits whatever has accumulated into the complete frames it contains and the
// partial tail still waiting for its newline.

export type FrameSplit = {
  frames: readonly string[];
  rest: string;
};

/** Split buffered stream text into complete frames plus the partial remainder. */
export const takeFrames = (buffered: string): FrameSplit => {
  const parts = buffered.split("\n");
  // `split` always yields one more element than there are newlines, and that
  // last element is exactly the text after the final newline: the partial tail.
  const rest = parts.at(-1) ?? "";
  return {
    frames: parts.slice(0, -1).filter((frame) => frame.trim().length > 0),
    rest,
  };
};

/**
 * A stateful reader over one stream: feed it each chunk, get back whatever
 * complete frames that chunk finished.
 *
 * It keeps the unfinished tail as the pieces it arrived in and only joins them
 * once a delimiter shows up. Re-joining on every chunk instead is quadratic,
 * which does not matter for a few hundred bytes of geometry and matters a great
 * deal for the megabytes of base64 in an app frame.
 */
export const createFrameReader = (): ((chunk: string) => readonly string[]) => {
  const pending: string[] = [];
  return (chunk: string) => {
    if (!chunk.includes("\n")) {
      pending.push(chunk);
      return [];
    }
    const { frames, rest } = takeFrames(pending.join("") + chunk);
    pending.length = 0;
    pending.push(rest);
    return frames;
  };
};

/** Append the frame delimiter unless the text already carries one. */
export const withFrameDelimiter = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;
