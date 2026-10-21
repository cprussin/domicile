// A size on disk as the Site data page shows it.

/** Decimal units, as the system's file managers count. */
const UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

const NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** `bytes` in the largest unit it reaches, such as "4.8 GB". */
export const byteSize = (bytes: number): string => {
  const power = Math.min(
    UNITS.length - 1,
    bytes < 1000 ? 0 : Math.floor(Math.log10(bytes) / 3),
  );
  return `${NUMBER.format(bytes / 1000 ** power)} ${UNITS[power]}`;
};
