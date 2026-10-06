import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import { curlFetch } from "./curl";
import { fakeSystem } from "./fake-system";
import type { Page } from "./favicon";

const fetched = (page: Page): Result<Option<Page>, SystemError> =>
  Ok(Some(page));

describe("curlFetch", () => {
  it("fetches a URL with curl, following redirects", async () => {
    const fetch = curlFetch(
      fakeSystem({}, (argv) => {
        expect(argv[0]).toBe("curl");
        expect(argv).toContain("--location");
        expect(argv.at(-1)).toBe("https://a.example/");
        return {
          code: 0,
          stderr: "https://www.a.example/home\ntext/html; charset=utf-8",
          stdout: new Uint8Array([0, 1, 2]),
        };
      }),
    );

    expect(await fetch("https://a.example/")).toStrictEqual(
      fetched({
        body: new Uint8Array([0, 1, 2]),
        contentType: "text/html; charset=utf-8",
        url: "https://www.a.example/home",
      }),
    );
  });

  it("reads an answer with no type as untyped", async () => {
    const fetch = curlFetch(
      fakeSystem({}, () => ({
        code: 0,
        stderr: "https://a.example/favicon.ico\n",
        stdout: "ico",
      })),
    );

    expect(await fetch("https://a.example/favicon.ico")).toStrictEqual(
      fetched({
        body: new TextEncoder().encode("ico"),
        contentType: undefined,
        url: "https://a.example/favicon.ico",
      }),
    );
  });

  it("is nothing when the site does not answer", async () => {
    // curl's code for a host it could not resolve.
    const fetch = curlFetch(
      fakeSystem({}, () => ({ code: 6, stderr: "\n", stdout: "" })),
    );

    expect(await fetch("https://nowhere.example/")).toStrictEqual(Ok(None()));
  });
});
