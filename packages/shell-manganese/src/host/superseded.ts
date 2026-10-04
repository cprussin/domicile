/**
 * Whether a host's ask failed because a newer one of its kind replaced it.
 *
 * `searchFiles`, `searchApps` and `previewFile` each keep one ask in flight:
 * a newer call rejects the older with an `AbortError`. That is not a failure,
 * only an answer nobody is waiting for any more.
 */
export const superseded = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
