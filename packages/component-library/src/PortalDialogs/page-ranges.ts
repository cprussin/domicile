import type { PageRange } from "@domicile-desktop/sdk/portal";

/**
 * Pages typed as `1-3, 5`, counted from 1. Blank text is every page, as no
 * ranges. `undefined` when the text names no pages it can read.
 */
export const pageRanges = (text: string): readonly PageRange[] | undefined => {
  const parts = text.trim() === "" ? [] : text.split(",");
  const ranges = parts.map((part) => pageRange(part.trim()));
  return ranges.every((range) => range !== undefined) ? ranges : undefined;
};

const pageRange = (part: string): PageRange | undefined => {
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
  if (match === null) {
    return undefined;
  } else {
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    return first >= 1 && first <= last ? { first, last } : undefined;
  }
};
