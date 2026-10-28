/** A link's speed in Mb/s, as people read it: `867 Mb/s`, `1 Gb/s`. */
export const speedOf = (mbps: number): string =>
  mbps >= 1000
    ? `${(Math.round(mbps / 100) / 10).toString()} Gb/s`
    : `${Math.round(mbps).toString()} Mb/s`;
