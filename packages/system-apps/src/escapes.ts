// The desktop entry spec's string escapes.

const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  n: "\n",
  r: "\r",
  s: " ",
  t: "\t",
};

/** `value` with `\s`, `\n`, `\t`, `\r` and `\\` resolved; any other `\` kept. */
export const unescaped = (value: string): string =>
  value.replaceAll(
    /\\(.?)/gs,
    (sequence, next: string) => ESCAPES[next] ?? sequence,
  );
