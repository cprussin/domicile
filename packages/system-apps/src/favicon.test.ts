import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { Page } from "./favicon";
import { favicon } from "./favicon";

/**
 * A web of pages by URL: where each landed after redirects, its type and its
 * body. Other URLs do not answer.
 */
const web =
  (
    pages: Readonly<
      Record<string, [landed: string, type: string, body: string | Uint8Array]>
    >,
  ) =>
  (url: string): Promise<Result<Option<Page>, SystemError>> => {
    const page = pages[url];
    return Promise.resolve(
      Ok(
        page === undefined
          ? None()
          : Some({
              body:
                typeof page[2] === "string"
                  ? new TextEncoder().encode(page[2])
                  : page[2],
              contentType: page[1],
              url: page[0],
            }),
      ),
    );
  };

/** The same page wherever it is asked for. */
const at = (
  url: string,
  type: string,
  body: string | Uint8Array,
): [string, string, string | Uint8Array] => [url, type, body];

const icon = (url: string): Result<Option<string>, SystemError> =>
  Ok(Some(url));

const none: Result<Option<string>, SystemError> = Ok(None());

describe("favicon", () => {
  it("draws the icon the page links, read against the page", async () => {
    const fetch = web({
      "https://sync.example/gui/": at(
        "https://sync.example/gui/",
        "text/html; charset=utf-8",
        "<html><head><LINK rel='shortcut icon' href=\"assets/fav.ico\"></head></html>",
      ),
      "https://sync.example/gui/assets/fav.ico": at(
        "https://sync.example/gui/assets/fav.ico",
        "image/x-icon",
        "ico",
      ),
    });

    expect(await favicon("https://sync.example/gui/", fetch)).toStrictEqual(
      icon("data:image/x-icon;base64,aWNv"),
    );
  });

  it("prefers the biggest icon linked, and a drawing over them all", async () => {
    const fetch = web({
      "https://a.example/": at(
        "https://a.example/",
        "text/html",
        `<link rel="icon" sizes="16x16" href="/16.png">
         <link rel="apple-touch-icon" href="/touch.png">
         <link rel="icon" sizes="32x32 48x48" href="/48.png">`,
      ),
      "https://a.example/16.png": at(
        "https://a.example/16.png",
        "image/png",
        "16",
      ),
      "https://a.example/48.png": at(
        "https://a.example/48.png",
        "image/png",
        "48",
      ),
      "https://a.example/touch.png": at(
        "https://a.example/touch.png",
        "image/png",
        "tt",
      ),
    });
    const drawn = web({
      "https://b.example/": at(
        "https://b.example/",
        "text/html",
        `<link rel="icon" sizes="512x512" href="/big.png">
         <link rel="icon" type="IMAGE/SVG+XML" href="/drawn">`,
      ),
      "https://b.example/big.png": at(
        "https://b.example/big.png",
        "image/png",
        "big",
      ),
      "https://b.example/drawn": at(
        "https://b.example/drawn",
        "image/svg+xml",
        "svg",
      ),
    });

    // A touch icon without `sizes` counts as 180 pixels.
    expect(await favicon("https://a.example/", fetch)).toStrictEqual(
      icon("data:image/png;base64,dHQ="),
    );
    expect(await favicon("https://b.example/", drawn)).toStrictEqual(
      icon("data:image/svg+xml;base64,c3Zn"),
    );
  });

  it("asks a site that links no icon for its favicon.ico", async () => {
    const fetch = web({
      "https://c.example/app": at(
        "https://c.example/app",
        "text/html",
        "<!-- <link rel=icon href=/commented.png> --><p>hi</p>",
      ),
      "https://c.example/commented.png": at(
        "https://c.example/commented.png",
        "image/png",
        "no",
      ),
      "https://c.example/favicon.ico": at(
        "https://c.example/favicon.ico",
        "image/vnd.microsoft.icon",
        "ico",
      ),
    });

    expect(await favicon("https://c.example/app", fetch)).toStrictEqual(
      icon("data:image/vnd.microsoft.icon;base64,aWNv"),
    );
  });

  it("ignores the links of a page that sent it to another site", async () => {
    // A signed-out app redirects to its sign-in page, whose icon is not the
    // app's.
    const fetch = web({
      "https://accounts.example/accounts.png": at(
        "https://accounts.example/accounts.png",
        "image/png",
        "no",
      ),
      "https://mail.example/": at(
        "https://accounts.example/signin",
        "text/html",
        "<link rel=icon href=/accounts.png>",
      ),
      "https://mail.example/favicon.ico": at(
        "https://mail.example/favicon.ico",
        "image/x-icon",
        "ico",
      ),
    });

    expect(await favicon("https://mail.example/", fetch)).toStrictEqual(
      icon("data:image/x-icon;base64,aWNv"),
    );
  });

  it("keeps the links of a page that redirected within its site", async () => {
    const fetch = web({
      "https://f.example/": at(
        "https://www.f.example/home",
        "text/html",
        "<link rel=icon href=/big.svg>",
      ),
      "https://www.f.example/big.svg": at(
        "https://www.f.example/big.svg",
        "image/svg+xml",
        "svg",
      ),
    });

    expect(await favicon("https://f.example/", fetch)).toStrictEqual(
      icon("data:image/svg+xml;base64,c3Zn"),
    );
  });

  it("knows an icon sent as bytes by what it starts with", async () => {
    const fetch = web({
      "https://j.example/favicon.ico": at(
        "https://j.example/favicon.ico",
        "application/octet-stream",
        new Uint8Array([0, 0, 1, 0, 1, 0]),
      ),
    });

    expect(await favicon("https://j.example/", fetch)).toStrictEqual(
      icon("data:image/x-icon;base64,AAABAAEA"),
    );
  });

  it("finds no icon in what is not a picture, is too big, or does not answer", async () => {
    // Many servers answer a missing favicon.ico with the app's page.
    const page = web({
      "https://d.example/favicon.ico": at(
        "https://d.example/",
        "text/html",
        "<p>",
      ),
    });
    const huge = web({
      "https://e.example/favicon.ico": at(
        "https://e.example/favicon.ico",
        "image/png",
        new Uint8Array(128 * 1024 + 1),
      ),
    });

    expect(await favicon("https://d.example/", page)).toStrictEqual(none);
    expect(await favicon("https://e.example/", huge)).toStrictEqual(none);
    expect(await favicon("https://g.example/", web({}))).toStrictEqual(none);
  });
});
