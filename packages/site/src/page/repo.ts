/** The repository, on the branch the site is built from. */
export const REPO = "https://github.com/cprussin/domicile";

/** A file in the repository, on `stable`, which the site follows. */
export const repoFile = (path: string): string => `${REPO}/blob/stable/${path}`;
