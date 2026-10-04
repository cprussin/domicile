// Framing for chrome→host messages, which are newline-delimited JSON.

/** Append the frame delimiter unless the text already carries one. */
export const withFrameDelimiter = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;
