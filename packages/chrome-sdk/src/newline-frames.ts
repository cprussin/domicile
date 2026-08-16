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

/** Append the frame delimiter unless the text already carries one. */
export const withFrameDelimiter = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;
