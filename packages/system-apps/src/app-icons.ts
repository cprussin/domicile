// Desktop-entry icon names resolved to `data:` URLs, for `Icon` and
// `X-Domicile-Preview`.
//
// Follows the icon theme spec: `icons/hicolor/<size>/<context>/<name>.<ext>`
// under each data directory, then `pixmaps/<name>.<ext>`. Only `hicolor` is
// searched: every application installs into it and every theme inherits it.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { dataUrl } from "./data-url";
import { allOk, orAbsent } from "./results";

/**
 * Icon sizes to try, most preferred first. The first few are large enough for
 * a preview and small enough to draw in every row.
 */
const SIZES = [
  "48x48",
  "64x64",
  "32x32",
  "96x96",
  "128x128",
  "scalable",
  "256x256",
  "24x24",
  "22x22",
  "16x16",
  "512x512",
];

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

/** A directory icons may be in, and the file names it holds. */
type Listed = { dir: string; names: ReadonlySet<string> };

/**
 * Icons under `dataDirs`, highest priority first, in `contexts` (theme
 * subdirectories such as `apps` or `status`) in order. An absolute name is
 * read as a file, as the spec allows.
 *
 * Lists the theme's directories once, on the first lookup, and each name
 * once. Make a new lookup to see newly installed icons.
 */
export const appIcons = (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[] = ["apps"],
): IconLookup => {
  let listed: Promise<Result<Listed[], SystemError>> | undefined;
  const looked = new Map<
    string,
    Promise<Result<Option<string>, SystemError>>
  >();
  return (name) => {
    const known = looked.get(name);
    if (known === undefined) {
      listed ??= listings(system, dataDirs, contexts);
      const lookup = name.startsWith("/")
        ? read(system, name)
        : listed.then((dirs) =>
            dirs.andThenAsync((each) => firstUsable(system, each, name)),
          );
      looked.set(name, lookup);
      return lookup;
    } else {
      return known;
    }
  };
};

/** Every directory an icon may be in, in the order to search them. */
const listings = async (
  system: System,
  dataDirs: readonly string[],
  contexts: readonly string[],
): Promise<Result<Listed[], SystemError>> => {
  const themed = allOk(
    await Promise.all(dataDirs.map((dir) => themeDirs(system, dir, contexts))),
  ).map((dirs) => dirs.flat());
  const pixmaps = dataDirs.map((dir) => `${dir}/pixmaps`);
  return themed.andThenAsync(async (dirs) =>
    allOk(
      await Promise.all(
        [...dirs, ...pixmaps].map(async (dir) =>
          orAbsent(await system.readDir(dir), []).map(
            (entries): Listed => ({
              dir,
              names: new Set(entries.map((entry) => entry.name)),
            }),
          ),
        ),
      ),
    ),
  );
};

/** `hicolor`'s `contexts` directories under `dataDir`, by preferred size. */
const themeDirs = async (
  system: System,
  dataDir: string,
  contexts: readonly string[],
): Promise<Result<string[], SystemError>> => {
  const theme = `${dataDir}/icons/hicolor`;
  return orAbsent(await system.readDir(theme), []).map((entries) => {
    const sizes = new Set(entries.map((entry) => entry.name));
    return contexts.flatMap((context) =>
      SIZES.filter((size) => sizes.has(size)).map(
        (size) => `${theme}/${size}/${context}`,
      ),
    );
  });
};

/** The first of `name`'s files in `dirs` that can be drawn. */
const firstUsable = async (
  system: System,
  dirs: readonly Listed[],
  name: string,
): Promise<Result<Option<string>, SystemError>> => {
  const candidates = dirs.flatMap(({ dir, names }) =>
    Object.keys(KINDS)
      .map((kind) => `${name}.${kind}`)
      .filter((file) => names.has(file))
      .map((file) => `${dir}/${file}`),
  );
  for (const path of candidates) {
    const icon = await read(system, path);
    if (icon.mapOr(true, (found) => found.isSome())) {
      return icon;
    }
  }
  return Ok(None());
};

/** The file at `path` as a `data:` URL, or nothing if it cannot be drawn. */
const read = async (
  system: System,
  path: string,
): Promise<Result<Option<string>, SystemError>> => {
  const mime = KINDS[path.slice(path.lastIndexOf(".") + 1)];
  return mime === undefined
    ? Ok(None())
    : orAbsent(
        await (await system.stat(path)).andThenAsync(async ({ size }) =>
          size > LARGEST
            ? Ok(None<string>())
            : (await system.readFile(path)).map((bytes) =>
                Some(dataUrl(mime, bytes)),
              ),
        ),
        None(),
      );
};
