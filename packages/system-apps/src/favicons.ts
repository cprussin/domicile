// Bookmark icons, looked up in the background and kept for the page's life. A
// site can take seconds to answer, so a search shows the icons found so far.

import type { Option, Result } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

/** How long to wait before asking again a site that gave no icon. */
const RETRY_AFTER_MS = 60_000;

enum LookedKind {
  InFlight,
  Found,
  /** The site gave no icon, or the lookup failed. */
  Missed,
}

const Looked = {
  Found: (icon: string) => ({ icon, kind: LookedKind.Found as const }),
  InFlight: () => ({ kind: LookedKind.InFlight as const }),
  Missed: (atMs: number) => ({ atMs, kind: LookedKind.Missed as const }),
};

type Looked = ReturnType<(typeof Looked)[keyof typeof Looked]>;

export type Favicons = {
  /** The icon found for `url`, if one has been. */
  icon: (url: string) => Option<string>;
  /**
   * Looks up, one at a time, each of `urls` that is new or whose miss is due
   * a retry. Settles when they are done.
   */
  lookFor: (urls: readonly string[]) => Promise<void>;
};

/** How {@link favicons} keeps time and reports failures; for tests. */
export type FaviconsOptions = {
  retryAfterMs?: number;
  now?: () => number;
  /** Told of each failed lookup, which is retried later. Logs by default. */
  failed?: (url: string, error: SystemError) => void;
};

/**
 * Icons `find` finds, by bookmark URL. A miss or a failure is asked again
 * after a minute, since the network may come up after the desktop.
 */
export const favicons = (
  find: (url: string) => Promise<Result<Option<string>, SystemError>>,
  {
    failed = logged,
    now = Date.now,
    retryAfterMs = RETRY_AFTER_MS,
  }: FaviconsOptions = {},
): Favicons => {
  const looked = new Map<string, Looked>();
  return {
    icon: (url) => {
      const known = looked.get(url);
      return known?.kind === LookedKind.Found ? Some(known.icon) : None();
    },
    lookFor: async (urls) => {
      const wanted = [...new Set(urls)].filter((url) =>
        due(looked.get(url), now(), retryAfterMs),
      );
      for (const url of wanted) {
        looked.set(url, Looked.InFlight());
      }
      for (const url of wanted) {
        looked.set(url, lookedOf(await find(url), url, now(), failed));
      }
    },
  };
};

const due = (
  known: Looked | undefined,
  nowMs: number,
  retryAfterMs: number,
): boolean => {
  if (known === undefined) {
    return true;
  } else {
    switch (known.kind) {
      case LookedKind.Missed: {
        return nowMs - known.atMs >= retryAfterMs;
      }
      case LookedKind.InFlight:
      case LookedKind.Found: {
        return false;
      }
    }
  }
};

const lookedOf = (
  found: Result<Option<string>, SystemError>,
  url: string,
  nowMs: number,
  failed: (url: string, error: SystemError) => void,
): Looked =>
  found.match({
    Err: (error): Looked => {
      failed(url, error);
      return Looked.Missed(nowMs);
    },
    Ok: (icon) =>
      icon.match({
        None: (): Looked => Looked.Missed(nowMs),
        Some: (each): Looked => Looked.Found(each),
      }),
  });

const logged = (url: string, error: SystemError): void => {
  // biome-ignore lint/suspicious/noConsole: surfacing a lookup that is retried later
  console.error(`could not look for ${url}'s icon`, error);
};
