// Fetching a web page with `curl`. A shell page cannot: other sites do not
// allow its origin to read their answers.

import { None, Some } from "@cprussin/option-result";
import type { System } from "@domicile-desktop/sdk/system";

import type { Fetch, Page } from "./favicon";

/** Seconds a site may take. Lookups run one at a time. */
const PATIENCE = "10";

/** A browser's user agent, since some sites serve other clients a different page. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/**
 * Fetches with the `curl` on the desktop's `PATH`, following redirects. Sends
 * no cookies. A site that does not answer, or answers with an error, is
 * nothing.
 */
export const curlFetch =
  (system: System): Fetch =>
  async (url) =>
    (
      await system.spawn([
        "curl",
        "--silent",
        "--fail",
        "--location",
        "--max-time",
        PATIENCE,
        "--user-agent",
        USER_AGENT,
        // After the body, on stderr: where it landed, then its type.
        "--write-out",
        "%{stderr}%{url_effective}\n%{content_type}",
        url,
      ])
    ).andThenAsync(async (curl) => {
      const [body, written, exited] = await Promise.all([
        new Response(curl.stdout).arrayBuffer(),
        new Response(curl.stderr).text(),
        curl.exited,
      ]);
      return exited.map(({ code }) => {
        const [landed = url, contentType = ""] = written.split("\n");
        const page: Page = {
          body: new Uint8Array(body),
          contentType: contentType === "" ? undefined : contentType,
          url: landed,
        };
        return code === 0 ? Some(page) : None<Page>();
      });
    });
