// What went wrong with the list, which decides how it can be tried again.

/** The work that failed. */
export enum FailedTask {
  /** The first page, for a new list or search. */
  Load,
  /** A later page. */
  LoadMore,
  /** Reloading the rows on screen after the history changed. */
  Reload,
  /** Deleting rows' visits. */
  Remove,
}

export const Failure = {
  Load: (error: unknown) => ({ error, task: FailedTask.Load as const }),
  LoadMore: (error: unknown) => ({ error, task: FailedTask.LoadMore as const }),
  Reload: (error: unknown) => ({ error, task: FailedTask.Reload as const }),
  Remove: (error: unknown) => ({ error, task: FailedTask.Remove as const }),
};

export type Failure = ReturnType<(typeof Failure)[keyof typeof Failure]>;
