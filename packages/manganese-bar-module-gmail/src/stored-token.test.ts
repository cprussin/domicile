import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";

import { heldStorage } from "./held-google";
import { forgetToken, storedToken, storeToken } from "./stored-token";

describe("storedToken", () => {
  it("is nothing for an account never signed in", () => {
    expect(storedToken("me@example.com", heldStorage())).toStrictEqual(None());
  });

  it("is the account's stored token, and no other account's", () => {
    const storage = heldStorage();

    storeToken("me@example.com", "r", storage);

    expect(storedToken("me@example.com", storage)).toStrictEqual(Some("r"));
    expect(storedToken("you@example.com", storage)).toStrictEqual(None());
  });

  it("is nothing once forgotten", () => {
    const storage = heldStorage();

    storeToken("me@example.com", "r", storage);
    forgetToken("me@example.com", storage);

    expect(storedToken("me@example.com", storage)).toStrictEqual(None());
  });
});
