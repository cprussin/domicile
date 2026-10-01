/**
 * Where `name` in `directory` is. The root already ends in the `/` a name goes
 * after.
 */
export const pathIn = (directory: string, name: string): string =>
  directory === "/" ? `/${name}` : `${directory}/${name}`;
