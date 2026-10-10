// What a save would overwrite.

/** What already has the name a save would use. */
export enum Clash {
  None,
  File,
  Folder,
}

/** What in `entries` has `name`; subdirectory entries end in `/`. */
export const clashOf = (entries: readonly string[], name: string): Clash => {
  if (entries.includes(name)) {
    return Clash.File;
  } else {
    return entries.includes(`${name}/`) ? Clash.Folder : Clash.None;
  }
};
