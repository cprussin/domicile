/** What became of a mixer's request. */
export enum Asked {
  Done,
  /** Skipped: a later volume for the same id came first. */
  Overtaken,
}
