// The Chrome Web Store id an "Add extension" field was given, as itself or
// inside the extension's Store address.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

/** A Store id: 32 letters from `a` to `p`, which the config also checks. */
const ID = /^[a-p]{32}$/;

/** The id in `written`, an id or a Store address. */
export const webStoreId = (written: string): Result<string, string> => {
  const trimmed = written.trim();
  const id = ID.test(trimmed) ? trimmed : idInAddress(trimmed);
  return id === undefined
    ? Err(
        "Paste an extension's Chrome Web Store address, or its id: 32 letters from a to p",
      )
    : Ok(id);
};

/** The last path segment of a Store address, if it is an id. */
const idInAddress = (address: string): string | undefined => {
  const url = URL.parse(address);
  const last = url?.pathname.split("/").findLast((segment) => segment !== "");
  return last !== undefined && ID.test(last) ? last : undefined;
};
