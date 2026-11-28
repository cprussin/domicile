// Helpers for the `ReadableStream`s the desktop hands out: a process's
// output, a watch's changes, a D-Bus match's signals.

/** Calls `each` with every item `items` brings, until it closes. */
export const eachOf = async <T>(
  items: ReadableStream<T>,
  each: (item: T) => void,
): Promise<void> => {
  for await (const item of items) {
    each(item);
  }
};
