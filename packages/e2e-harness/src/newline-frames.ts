// The chrome→host direction is newline-delimited JSON: whole messages, no
// binary. (The host→chrome direction carries pixels too and is read by
// `host-stream.ts`.)

/** Append the frame delimiter unless the text already carries one. */
export const withFrameDelimiter = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;
