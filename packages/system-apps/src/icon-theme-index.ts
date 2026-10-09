// An icon theme's `index.theme`: its parents and the directories it holds
// icons in. See
// https://specifications.freedesktop.org/icon-theme-spec/latest/.

/** How a directory's icons scale. */
export enum DirectoryType {
  Fixed,
  Scalable,
  Threshold,
}

/** A theme directory and the icon sizes it suits. */
export type ThemeDirectory = {
  /** Relative to the theme, such as `16x16/actions`. */
  path: string;
  /** As `contexts` name it: `apps`, `actions`, `status` and so on. */
  context: string | undefined;
  type: DirectoryType;
  size: number;
  minSize: number;
  maxSize: number;
  threshold: number;
};

export type IndexTheme = {
  /** `Inherits`, in order. */
  inherits: readonly string[];
  /** `Directories`, in order. */
  directories: readonly ThemeDirectory[];
};

/** The spec's contexts, by the directory names themes install them under. */
const CONTEXTS: Readonly<Record<string, string>> = {
  Actions: "actions",
  Animations: "animations",
  Applications: "apps",
  Categories: "categories",
  Devices: "devices",
  Emblems: "emblems",
  Emotes: "emotes",
  International: "intl",
  MimeTypes: "mimetypes",
  Places: "places",
  Status: "status",
};

/** `text` read as an `index.theme`. A directory with no `Size` is skipped. */
export const parseIndexTheme = (text: string): IndexTheme => {
  const groups = groupsOf(text);
  const theme = groups.get("Icon Theme") ?? new Map<string, string>();
  return {
    directories: listOf(theme.get("Directories")).flatMap((path) => {
      const keys = groups.get(path) ?? new Map<string, string>();
      const size = numberOf(keys.get("Size"));
      const context = keys.get("Context");
      return size === undefined
        ? []
        : [
            {
              context:
                context === undefined
                  ? undefined
                  : (CONTEXTS[context] ?? context.toLowerCase()),
              maxSize: numberOf(keys.get("MaxSize")) ?? size,
              minSize: numberOf(keys.get("MinSize")) ?? size,
              path,
              size,
              threshold: numberOf(keys.get("Threshold")) ?? 2,
              type: typeOf(keys.get("Type")),
            },
          ];
    }),
    inherits: listOf(theme.get("Inherits")),
  };
};

/**
 * How far `directory`'s icons are from `size` pixels: 0 where they suit it.
 * The spec's `DirectorySizeDistance`, at scale 1.
 */
export const sizeDistance = (
  { maxSize, minSize, size: own, threshold, type }: ThemeDirectory,
  size: number,
): number => {
  switch (type) {
    case DirectoryType.Fixed: {
      return Math.abs(own - size);
    }
    case DirectoryType.Scalable: {
      return Math.max(minSize - size, size - maxSize, 0);
    }
    case DirectoryType.Threshold: {
      if (size < own - threshold) {
        return minSize - size;
      } else {
        return size > own + threshold ? size - maxSize : 0;
      }
    }
  }
};

/** Each group's keys; the first of a repeated key wins. */
const groupsOf = (
  text: string,
): ReadonlyMap<string, ReadonlyMap<string, string>> => {
  const groups = new Map<string, Map<string, string>>();
  let group = new Map<string, string>();
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1);
      group = groups.get(name) ?? new Map<string, string>();
      groups.set(name, group);
    } else {
      const at = line.indexOf("=");
      const key = line.slice(0, at).trim();
      if (at > 0 && !group.has(key)) {
        group.set(key, line.slice(at + 1).trim());
      }
    }
  }
  return groups;
};

const listOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "");

const numberOf = (value: string | undefined): number | undefined => {
  const read = Number.parseInt(value ?? "", 10);
  return Number.isNaN(read) ? undefined : read;
};

/** `Type`, which is `Threshold` when absent or unknown. */
const typeOf = (value: string | undefined): DirectoryType => {
  switch (value) {
    case "Fixed": {
      return DirectoryType.Fixed;
    }
    case "Scalable": {
      return DirectoryType.Scalable;
    }
    default: {
      return DirectoryType.Threshold;
    }
  }
};
