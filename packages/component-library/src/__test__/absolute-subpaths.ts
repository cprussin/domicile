/** One drawing command with absolute coordinates. */
type Command = { name: string; values: number[] };

/** Where drawing is, and where the subpath it is in started. */
type Pen = { startX: number; startY: number; x: number; y: number };

/** How many numbers each command takes. */
const ARITY: Record<string, number> = {
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
};

/**
 * Splits SVG path data into its subpaths, each a list of commands with
 * absolute coordinates, so paths written differently can be compared.
 *
 * Reading a path is stateful, since a relative command moves from wherever
 * the last one ended; so this walks it with a pen.
 */
export const absoluteSubpaths = (d: string): Command[][] => {
  const subpaths: Command[][] = [];
  const pen: Pen = { startX: 0, startY: 0, x: 0, y: 0 };
  for (const [, letter = "", args = ""] of d.matchAll(
    /([A-Za-z])([^A-Za-z]*)/g,
  )) {
    const name = letter.toUpperCase();
    const arity = ARITY[name];
    if (arity === undefined) {
      throw new Error(`unknown path command: ${letter}`);
    } else if (arity === 0) {
      currentOf(subpaths).push({ name, values: [] });
      pen.x = pen.startX;
      pen.y = pen.startY;
    } else {
      const numbers = [
        ...args.matchAll(/-?(?:\d*\.\d+|\d+\.?)(?:e-?\d+)?/gi),
      ].map(([n]) => Number(n));
      for (let at = 0; at < numbers.length; at += arity) {
        // Pairs after a move's first are lines.
        const command = at > 0 && name === "M" ? "L" : name;
        const values = numbers
          .slice(at, at + arity)
          .map((value, index) =>
            letter === name ? value : value + offsetOf(command, index, pen),
          );
        if (command === "M") {
          subpaths.push([]);
          pen.startX = values[0] ?? Number.NaN;
          pen.startY = values[1] ?? Number.NaN;
        }
        currentOf(subpaths).push({ name: command, values });
        moveTo(pen, command, values);
      }
    }
  }
  return subpaths;
};

/** The subpath being drawn. A path must start with a move. */
const currentOf = (subpaths: Command[][]): Command[] => {
  const current = subpaths.at(-1);
  if (current === undefined) {
    throw new Error("path data must start with a move");
  } else {
    return current;
  }
};

/** What a relative command's `index`th number is measured from. */
const offsetOf = (command: string, index: number, pen: Pen): number => {
  switch (command) {
    case "H":
      return pen.x;
    case "V":
      return pen.y;
    case "A":
      // Only an arc's end point moves; its radii, rotation and flags do not.
      return arcOffsetOf(index, pen);
    default:
      return index % 2 === 0 ? pen.x : pen.y;
  }
};

const arcOffsetOf = (index: number, pen: Pen): number => {
  switch (index) {
    case 5:
      return pen.x;
    case 6:
      return pen.y;
    default:
      return 0;
  }
};

/** Puts the pen where `command` ended. */
const moveTo = (pen: Pen, command: string, values: readonly number[]) => {
  switch (command) {
    case "H":
      pen.x = values[0] ?? Number.NaN;
      break;
    case "V":
      pen.y = values[0] ?? Number.NaN;
      break;
    default:
      pen.x = values.at(-2) ?? Number.NaN;
      pen.y = values.at(-1) ?? Number.NaN;
  }
};
