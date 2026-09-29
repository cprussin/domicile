/**
 * Where a save of `name` into `directory` goes, relative to home.
 *
 * Home is the empty path, and a save into it is the name alone: a leading `/`
 * would make the answer absolute, which the engine refuses.
 */
export const savedPath = (directory: string, name: string): string =>
  directory === "" ? name : `${directory}/${name}`;
