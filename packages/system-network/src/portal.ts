// Whether a captive portal holds the network, found by asking for a page that
// the open internet answers with nothing. A portal answers it with its sign-in
// page or a redirect to one. iwd and wpa_supplicant report no portal, so the
// check runs `curl` rather than asking the network service.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** Chrome's portal probe: `204 No Content` on the open internet. Plain http, so a portal can intercept it. */
export const PORTAL_PROBE = "http://www.gstatic.com/generate_204";

/** Seconds each try may take, and how many more tries follow a failed one. */
const PATIENCE = "5";
const RETRIES = "3";

/**
 * Where to sign in to the network's captive portal, or `None` when there is
 * none.
 *
 * Retries a probe that gets no answer, since an address or a route can arrive
 * a moment after the network does. An `Err` is a probe that never got one.
 */
export const checkPortal = async (domicile: {
  readonly processes: Pick<Processes, "run">;
}): Promise<Result<Option<string>, SystemError>> =>
  (
    await domicile.processes.run([
      "curl",
      "--silent",
      "--output",
      "/dev/null",
      "--max-time",
      PATIENCE,
      "--retry",
      RETRIES,
      "--retry-all-errors",
      "--write-out",
      "%{http_code} %{redirect_url}",
      PORTAL_PROBE,
    ])
  ).andThen(({ code, stdout }) =>
    code === 0
      ? Ok(signInOf(stdout))
      : Err({
          kind: SystemErrorKind.Other,
          message: `curl exited ${String(code)} asking for the portal probe`,
        }),
  );

/** The sign-in address in curl's `<status> <redirect>`, or `None` for `204`. */
const signInOf = (written: string): Option<string> => {
  const [status, redirect = ""] = written.split(" ");
  if (status === "204") {
    return None();
  } else {
    return Some(redirect === "" ? PORTAL_PROBE : redirect);
  }
};
