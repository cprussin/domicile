import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { favicons } from "./favicons";

type Found = Result<Option<string>, SystemError>;

/** A lookup whose answers a test gives one at a time, in the order asked. */
const answering = () => {
  const asked: { url: string; answer: (found: Found) => void }[] = [];
  return {
    asked,
    find: (url: string) =>
      new Promise<Found>((answer) => {
        asked.push({ answer, url });
      }),
  };
};

const A = "https://a.example/";

describe("favicons", () => {
  it("has the icon a lookup found", async () => {
    const icons = favicons(() => Promise.resolve(Ok(Some("data:icon"))));

    expect(icons.icon(A)).toStrictEqual(None());
    await icons.lookFor([A]);

    expect(icons.icon(A)).toStrictEqual(Some("data:icon"));
  });

  it("does not look for a site twice while it is being looked at", async () => {
    const lookup = answering();
    const icons = favicons(lookup.find);

    const looking = icons.lookFor([A]);
    await icons.lookFor([A]);
    lookup.asked[0]?.answer(Ok(Some("data:icon")));
    await looking;

    expect(lookup.asked.map(({ url }) => url)).toStrictEqual([A]);
  });

  it("asks again for a site that had no icon, or failed, once it is due", async () => {
    // The network may come up after the desktop.
    let now = 0;
    const answers: Found[] = [
      Ok(None()),
      Err({ kind: SystemErrorKind.NotFound, message: "no curl" }),
      Ok(Some("data:icon")),
    ];
    const failures: string[] = [];
    const icons = favicons(
      () => Promise.resolve(answers.shift() ?? Ok(None())),
      {
        failed: (url, error) => failures.push(`${url}: ${error.message}`),
        now: () => now,
        retryAfterMs: 60_000,
      },
    );

    await icons.lookFor([A]);
    now = 59_999;
    await icons.lookFor([A]);
    expect(answers).toHaveLength(2);

    now = 60_000;
    await icons.lookFor([A]);
    now = 120_000;
    await icons.lookFor([A]);

    expect(icons.icon(A)).toStrictEqual(Some("data:icon"));
    expect(failures).toStrictEqual([`${A}: no curl`]);
  });
});
