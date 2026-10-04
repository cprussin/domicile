/** The path of `name` inside `directory`, handling the root's trailing `/`. */
export const pathIn = (directory: string, name: string): string =>
  directory === "/" ? `/${name}` : `${directory}/${name}`;
