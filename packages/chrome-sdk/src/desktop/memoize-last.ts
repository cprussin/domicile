/**
 * `convert`, answering the same output while its input is the same object.
 *
 * The host hands out a new array only when its contents change, so a
 * namespace's converted list keeps its identity between changes, as a
 * `useSyncExternalStore` snapshot must.
 */
export const memoizeLast = <I, O>(
  convert: (input: I) => O,
): ((input: I) => O) => {
  let last: { input: I; output: O } | undefined;
  return (input) => {
    if (last === undefined || last.input !== input) {
      last = { input, output: convert(input) };
    }
    return last.output;
  };
};
