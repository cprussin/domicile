/** The CSS `filter` function that draws effect `name` with `args`. */
export const domicileShader = (
  name: string,
  ...args: readonly number[]
): string => `domicile-shader(${[name, ...args.map(String)].join(", ")})`;
