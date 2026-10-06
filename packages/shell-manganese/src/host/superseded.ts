/**
 * Whether a host request failed because a newer one of its kind replaced it.
 *
 * `searchFiles`, `searchApps` and `previewFile` each keep one request in
 * flight: a newer call rejects the older with an `AbortError`. That is not a
 * failure.
 */
export const superseded = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
