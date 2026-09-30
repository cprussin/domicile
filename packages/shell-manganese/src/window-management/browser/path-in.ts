/**
 * Where `name` in `directory` is, in the engine's vocabulary: absolute, or
 * relative to home — a save's path, and a listed row's.
 *
 * Home is the empty path, and a name in it is the name alone: a leading `/`
 * would make the answer absolute, and somewhere else. The root already ends in
 * the `/` a name goes after.
 */
export const pathIn = (directory: string, name: string): string => {
  switch (directory) {
    case "": {
      return name;
    }
    case "/": {
      return `/${name}`;
    }
    default: {
      return `${directory}/${name}`;
    }
  }
};
