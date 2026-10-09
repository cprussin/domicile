// Icon names resolved to `data:` URLs, for a desktop entry's `Icon` and
// `X-Domicile-Preview` and a tray menu's `icon-name`.
//
// Follows the icon theme spec: the theme, its `Inherits` and then `hicolor`,
// each under every data directory's `icons`, then `pixmaps`. A theme's
// `index.theme` says which directory suits a size. `hicolor` without one is
// read as `<size>/<context>`, the layout applications install into.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { dataUrl } from "./data-url";
import type { ThemeDirectory } from "./icon-theme-index";
import {
  DirectoryType,
  parseIndexTheme,
  sizeDistance,
} from "./icon-theme-index";
import { allOk, orAbsent } from "./results";

/** The theme every theme inherits from last. */
const HICOLOR = "hicolor";

/** The suffix of an icon drawn in one color, to be tinted. */
const SYMBOLIC = "-symbolic";

/** Extensions a page can draw, preferred first, and their MIME types. */
const KINDS: Readonly<Record<string, string>> = {
  png: "image/png",
  svg: "image/svg+xml",
};

/** Largest icon read. Every matched row draws one, so a larger file is skipped. */
const LARGEST = 128 * 1024;

/** An icon by name, as a `data:` URL, or nothing if none is usable. */
export type IconLookup = (
  name: string,
) => Promise<Result<Option<string>, SystemError>>;

/** An icon found by {@link themedIcons}. */
export type ThemedIcon = {
  url: string;
  /**
   * Drawn in one color, to be tinted to the text around it, such as a CSS
   * mask over `currentColor`.
   */
  symbolic: boolean;
};

export type ThemedIconLookup = (
  name: string,
) => Promise<Result<Option<ThemedIcon>, SystemError>>;

export type IconOptions = {
  /** The icon theme searched before `hicolor`, such as `readIconTheme` reads. */
  theme?: string | undefined;
  /** The size drawn at, in CSS pixels. 48, a launcher row's, by default. */
  size?: number;
};

/** {@link themedIcons}' URLs alone, for pictures that keep their own colors. */
export const appIcons = (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[] = ["apps"],
  options: IconOptions = {},
): IconLookup => {
  const lookup = themedIcons(system, dataDirs, contexts, options);
  return async (name) =>
    (await lookup(name)).map((icon) => icon.map(({ url }) => url));
};

/**
 * Icons under `dataDirs`, highest priority first, in `contexts` (`apps`,
 * `actions`, `status` and so on). A name with no icon falls back to its
 * `-symbolic` one. An absolute name is read as a file, as the spec allows.
 *
 * Reads the themes on the first lookup, and each name once. Make a new
 * lookup to see newly installed icons.
 */
export const themedIcons = (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[] = ["apps"],
  { size = 48, theme }: IconOptions = {},
): ThemedIconLookup => {
  let listed: Promise<Result<Listed[][], SystemError>> | undefined;
  const looked = new Map<
    string,
    Promise<Result<Option<ThemedIcon>, SystemError>>
  >();
  return (name) => {
    const known = looked.get(name);
    if (known === undefined) {
      listed ??= listings(system, dataDirs, contexts, theme);
      const lookup = name.startsWith("/")
        ? read(system, name)
        : listed.then((themes) =>
            themes.andThenAsync((each) => orSymbolic(system, each, size, name)),
          );
      looked.set(name, lookup);
      return lookup;
    } else {
      return known;
    }
  };
};

/** A directory icons may be in, the file names it holds, and its sizes. */
type Listed = {
  dir: string;
  names: ReadonlySet<string>;
  /** Absent for `pixmaps`, which suits every size. */
  directory: ThemeDirectory | undefined;
};

/** A theme's name and the directories it lists. */
type Theme = { name: string; directories: readonly ThemeDirectory[] };

/**
 * Every directory an icon may be in: one list per theme, in the order to
 * search them, then `pixmaps`.
 */
const listings = async (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[],
  theme: string | undefined,
): Promise<Result<Listed[][], SystemError>> => {
  const themes = await chain(system, dataDirs, contexts, theme);
  return themes.andThenAsync(async (each) =>
    allOk(
      await Promise.all([
        ...each.map((one) => themeListing(system, dataDirs, one)),
        pixmaps(system, dataDirs),
      ]),
    ),
  );
};

/**
 * `theme` and the themes it inherits, depth first and each once, then
 * `hicolor`. A theme installed nowhere is skipped.
 */
const chain = async (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[],
  theme: string | undefined,
): Promise<Result<Theme[], SystemError>> => {
  const seen = new Set<string>();
  const visit = async (name: string): Promise<Result<Theme[], SystemError>> => {
    if (seen.has(name)) {
      return Ok([]);
    } else {
      seen.add(name);
      const loaded = await loadTheme(system, dataDirs, contexts, name);
      return loaded.andThenAsync((found) =>
        found.match({
          None: () => Promise.resolve(Ok<Theme[], SystemError>([])),
          Some: async ({ directories, inherits }) =>
            // One parent at a time, so `seen` holds the earlier ones'.
            (
              await inherits.reduce(
                async (earlier, parent) =>
                  (
                    await earlier
                  ).andThenAsync(async (themes) =>
                    (await visit(parent)).map((more) => [...themes, ...more]),
                  ),
                Promise.resolve(Ok<Theme[], SystemError>([])),
              )
            ).map((parents) => [{ directories, name }, ...parents]),
        }),
      );
    }
  };
  const themed = await visit(theme ?? HICOLOR);
  return themed.andThenAsync(async (themes) =>
    (await visit(HICOLOR)).map((hicolor) => [...themes, ...hicolor]),
  );
};

/**
 * Theme `name`'s parents and the directories in `contexts`, from the first
 * `index.theme` found, or nothing if it is not installed.
 */
const loadTheme = async (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[],
  name: string,
): Promise<
  Result<
    Option<{ inherits: readonly string[]; directories: ThemeDirectory[] }>,
    SystemError
  >
> => {
  for (const dir of dataDirs) {
    const text = orAbsent(
      (await system.readTextFile(`${dir}/icons/${name}/index.theme`)).map(
        (read): Option<string> => Some(read),
      ),
      None(),
    );
    if (text.mapOr(true, (found) => found.isSome())) {
      return text.map((found) =>
        found.map((read) => {
          const { directories, inherits } = parseIndexTheme(read);
          return {
            directories: directories.filter(
              ({ context }) =>
                context === undefined || contexts.includes(context),
            ),
            inherits,
          };
        }),
      );
    }
  }
  return name === HICOLOR
    ? (await laidOut(system, dataDirs, contexts)).map((directories) =>
        Some({ directories, inherits: [] }),
      )
    : Ok(None());
};

/** `hicolor`'s `<size>/<context>` directories, read from its layout. */
const laidOut = async (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[],
): Promise<Result<ThemeDirectory[], SystemError>> =>
  allOk(
    await Promise.all(
      dataDirs.map(async (dir) =>
        orAbsent(await system.readDir(`${dir}/icons/${HICOLOR}`), []).map(
          (entries) => entries.map((entry) => entry.name),
        ),
      ),
    ),
  ).map((listed) => {
    const sizes = [...new Set(listed.flat())].flatMap(sized);
    return contexts.flatMap((context) =>
      sizes.map((directory) => ({
        ...directory,
        context,
        path: `${directory.path}/${context}`,
      })),
    );
  });

/** A `hicolor` size directory such as `48x48` or `scalable`. */
const sized = (name: string): Omit<ThemeDirectory, "context">[] => {
  const pixels = /^(\d+)x\1$/.exec(name)?.[1];
  if (name === "scalable") {
    return [
      {
        maxSize: 512,
        minSize: 1,
        path: name,
        size: 128,
        threshold: 2,
        type: DirectoryType.Scalable,
      },
    ];
  } else {
    return pixels === undefined
      ? []
      : [
          {
            maxSize: Number(pixels),
            minSize: Number(pixels),
            path: name,
            size: Number(pixels),
            threshold: 2,
            type: DirectoryType.Threshold,
          },
        ];
  }
};

/** `theme`'s directories that exist, each directory under every data directory. */
const themeListing = async (
  system: System,
  dataDirs: readonly string[],
  { directories, name }: Theme,
): Promise<Result<Listed[], SystemError>> => {
  const roots = allOk(
    await Promise.all(
      dataDirs.map(async (dir) => {
        const root = `${dir}/icons/${name}`;
        return orAbsent(await system.readDir(root), []).map((entries) => ({
          root,
          tops: new Set(entries.map((entry) => entry.name)),
        }));
      }),
    ),
  );
  return roots.andThenAsync(async (present) =>
    allOk(
      await Promise.all(
        directories.flatMap((directory) =>
          present
            .filter(({ tops }) => tops.has(directory.path.split("/")[0] ?? ""))
            .map(({ root }) =>
              listing(system, `${root}/${directory.path}`, directory),
            ),
        ),
      ),
    ),
  );
};

const pixmaps = async (
  system: System,
  dataDirs: readonly string[],
): Promise<Result<Listed[], SystemError>> =>
  allOk(
    await Promise.all(
      dataDirs.map((dir) => listing(system, `${dir}/pixmaps`, undefined)),
    ),
  );

const listing = async (
  system: System,
  dir: string,
  directory: ThemeDirectory | undefined,
): Promise<Result<Listed, SystemError>> =>
  orAbsent(await system.readDir(dir), []).map((entries) => ({
    dir,
    directory,
    names: new Set(entries.map((entry) => entry.name)),
  }));

/** `name`'s icon, else its `-symbolic` one's. */
const orSymbolic = async (
  system: System,
  themes: readonly Listed[][],
  size: number,
  name: string,
): Promise<Result<Option<ThemedIcon>, SystemError>> => {
  const plain = await named(system, themes, size, name);
  return plain.mapOr(true, (found) => found.isSome()) || name.endsWith(SYMBOLIC)
    ? plain
    : named(system, themes, size, `${name}${SYMBOLIC}`);
};

/**
 * `name`'s best icon: in the first theme that has one, the file whose
 * directory suits `size` best, earliest listed among equals.
 */
const named = async (
  system: System,
  themes: readonly Listed[][],
  size: number,
  name: string,
): Promise<Result<Option<ThemedIcon>, SystemError>> => {
  for (const dirs of themes) {
    const candidates = dirs
      .flatMap(({ dir, directory, names }) =>
        Object.keys(KINDS)
          .map((kind) => `${name}.${kind}`)
          .filter((file) => names.has(file))
          .map((file) => ({
            distance:
              directory === undefined ? 0 : sizeDistance(directory, size),
            path: `${dir}/${file}`,
          })),
      )
      .toSorted((a, b) => a.distance - b.distance);
    for (const { path } of candidates) {
      const icon = await read(system, path);
      if (icon.mapOr(true, (found) => found.isSome())) {
        return icon;
      }
    }
  }
  return Ok(None());
};

/** The file at `path` as an icon, or nothing if it cannot be drawn. */
const read = async (
  system: System,
  path: string,
): Promise<Result<Option<ThemedIcon>, SystemError>> => {
  const dot = path.lastIndexOf(".");
  const mime = KINDS[path.slice(dot + 1)];
  return mime === undefined
    ? Ok(None())
    : orAbsent(
        await (await system.stat(path)).andThenAsync(async ({ size }) =>
          size > LARGEST
            ? Ok(None<ThemedIcon>())
            : (await system.readFile(path)).map((bytes) =>
                Some({
                  symbolic: path.slice(0, dot).endsWith(SYMBOLIC),
                  url: dataUrl(mime, bytes),
                }),
              ),
        ),
        None(),
      );
};
