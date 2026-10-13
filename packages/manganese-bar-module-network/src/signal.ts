/** A Wi-Fi signal's grade, by thirds. */
export type Signal = "strong" | "fair" | "weak";

/** The grade of a strength from 0 through 1. */
export const signalOf = (strength: number): Signal => {
  if (strength >= 2 / 3) {
    return "strong";
  } else if (strength >= 1 / 3) {
    return "fair";
  } else {
    return "weak";
  }
};
