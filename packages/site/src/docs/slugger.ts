// Heading ids as GitHub makes them, so links written for GitHub's renderer
// land on the same headings here.

/**
 * A function from heading text to a unique id: lower case, punctuation
 * dropped, spaces dashed, and a number after a repeat.
 */
export const slugger = (): ((text: string) => string) => {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replaceAll(" ", "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count.toString()}`;
  };
};
