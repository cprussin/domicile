// A bookmark's icon, picked as a browser picks one: the page's
// `<link rel="icon">`, else `/favicon.ico`. The caller does the fetching.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import { dataUrl } from "./data-url";

/** Largest icon drawn, as for an application's. */
const LARGEST = 128 * 1024;

/** Assumed size of an unsized touch icon, per Apple. */
const TOUCH_ICON_SIZE = 180;

/** Assumed size of an unsized icon, as in a browser tab. */
const UNSIZED = 16;

/** How an icon's bytes start, for a server that names no image type. */
const MAGIC: readonly [start: readonly number[], mime: string][] = [
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0, 0, 1, 0], "image/x-icon"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x3c, 0x73, 0x76, 0x67], "image/svg+xml"],
];

/** A fetched URL: where it landed after redirects, its type and its body. */
export type Page = {
  url: string;
  contentType: string | undefined;
  body: Uint8Array;
};

/** Fetches a URL, or nothing if it does not answer. */
export type Fetch = (url: string) => Promise<Result<Option<Page>, SystemError>>;

/**
 * The icon for `url` as a `data:` URL, or nothing if none is usable.
 *
 * Tries the page's icon links first, SVG then largest. Links are ignored if
 * the page redirected off-site, for example to a sign-in page; a parent or
 * subdomain such as `www.` counts as the same site. Then tries
 * `/favicon.ico`.
 */
export const favicon = async (
  url: string,
  fetch: Fetch,
): Promise<Result<Option<string>, SystemError>> => {
  const asked = new URL(url);
  return (await fetch(url)).andThenAsync((page) =>
    firstPicture(
      [
        ...page.match({
          None: () => [],
          Some: (found) =>
            isHtml(found) && sameSite(asked, new URL(found.url))
              ? iconLinks(found)
              : [],
        }),
        new URL("/favicon.ico", asked).href,
      ],
      fetch,
    ),
  );
};

/** The first of `urls` that answers with a picture. */
const firstPicture = async (
  urls: readonly string[],
  fetch: Fetch,
): Promise<Result<Option<string>, SystemError>> => {
  for (const url of urls) {
    const found = (await fetch(url)).map((page) =>
      page.andThen((answer) => picture(answer)),
    );
    if (found.mapOr(true, (icon) => icon.isSome())) {
      return found;
    }
  }
  return Ok(None());
};

const isHtml = ({ contentType }: Page): boolean => {
  const type = contentType?.toLowerCase() ?? "";
  return (
    type.startsWith("text/html") || type.startsWith("application/xhtml+xml")
  );
};

/** Whether the hosts match or one is a subdomain of the other. */
const sameSite = (asked: URL, landed: URL): boolean =>
  asked.hostname === landed.hostname ||
  asked.hostname.endsWith(`.${landed.hostname}`) ||
  landed.hostname.endsWith(`.${asked.hostname}`);

/** The icons `page` links, resolved against it, best first. */
const iconLinks = (page: Page): string[] =>
  [
    ...new DOMParser()
      .parseFromString(new TextDecoder().decode(page.body), "text/html")
      .querySelectorAll("link"),
  ]
    .flatMap((link) => {
      const rels = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
      const touch = rels.includes("apple-touch-icon");
      const href = link.getAttribute("href");
      if (
        (rels.includes("icon") || touch) &&
        href !== null &&
        URL.canParse(href, page.url)
      ) {
        const url = new URL(href, page.url);
        const drawn =
          link.getAttribute("type")?.toLowerCase() === "image/svg+xml" ||
          url.pathname.toLowerCase().endsWith(".svg");
        const size =
          largestSize(link.getAttribute("sizes") ?? "") ??
          (touch ? TOUCH_ICON_SIZE : UNSIZED);
        return [{ drawn, size, url: url.href }];
      } else {
        return [];
      }
    })
    // Stable, so page order holds among equal icons.
    .toSorted((a, b) => Number(b.drawn) - Number(a.drawn) || b.size - a.size)
    .map(({ url }) => url);

/** The largest size in a `sizes` attribute; `any` is largest. */
const largestSize = (sizes: string): number | undefined => {
  const each = sizes
    .toLowerCase()
    .split(/\s+/)
    .map((size) => {
      const [width, height] = size.split("x").map(Number);
      return size === "any"
        ? Number.POSITIVE_INFINITY
        : Math.max(width ?? Number.NaN, height ?? Number.NaN);
    })
    .filter((size) => !Number.isNaN(size));
  return each.length === 0 ? undefined : Math.max(...each);
};

/**
 * `page` as a `data:` URL if it is a small enough picture. Sniffs the body
 * when the type is not `image/*`, since some servers send `.ico` without one.
 */
const picture = ({ body, contentType }: Page): Option<string> => {
  const said = contentType?.split(";")[0]?.trim();
  const mime = said?.toLowerCase().startsWith("image/") ? said : sniffed(body);
  return mime === undefined || body.length > LARGEST
    ? None()
    : Some(dataUrl(mime, body));
};

const sniffed = (body: Uint8Array): string | undefined => {
  const start = body.findIndex(
    (byte) => ![0x20, 0x09, 0x0a, 0x0d, 0x0c].includes(byte),
  );
  const trimmed = start === -1 ? new Uint8Array() : body.subarray(start);
  return MAGIC.find(([magic]) =>
    magic.every((byte, at) => trimmed[at] === byte),
  )?.[1];
};
