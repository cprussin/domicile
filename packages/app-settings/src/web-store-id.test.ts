import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { webStoreId } from "./web-store-id";

const UBLOCK = "ddkjiahejlhfcafbddmgiahcphecmpfh";

describe(webStoreId, () => {
  it("takes an id as it is", () => {
    expect(webStoreId(` ${UBLOCK} `)).toEqual(Ok(UBLOCK));
  });

  it("finds the id in a Web Store address", () => {
    expect(
      webStoreId(
        `https://chromewebstore.google.com/detail/ublock-origin-lite/${UBLOCK}?hl=en`,
      ),
    ).toEqual(Ok(UBLOCK));
    expect(
      webStoreId(`https://chrome.google.com/webstore/detail/x/${UBLOCK}`),
    ).toEqual(Ok(UBLOCK));
  });

  it("says what an id looks like when given something else", () => {
    expect(webStoreId("ublock")).toEqual(
      Err(
        "Paste an extension's Chrome Web Store address, or its id: 32 letters from a to p",
      ),
    );
  });
});
