import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";

// Each account's refresh token, stored locally. Every page of the desktop
// shares one origin, so every bar reads the same token.

type Storage = Pick<globalThis.Storage, "getItem" | "removeItem" | "setItem">;

/** The account's storage key, versioned per the persisted-state rule. */
const keyOf = (email: string): string => `gmail-refresh-token:v1:${email}`;

/** The account's refresh token, or nothing before it signs in. */
export const storedToken = (
  email: string,
  storage: Storage = globalThis.localStorage,
): Option<string> => {
  const token = storage.getItem(keyOf(email));
  return token === null ? None() : Some(token);
};

/** Stores the account's refresh token for every bar and future loads. */
export const storeToken = (
  email: string,
  token: string,
  storage: Storage = globalThis.localStorage,
): void => {
  storage.setItem(keyOf(email), token);
};

/** Forgets a refresh token Google no longer takes. */
export const forgetToken = (
  email: string,
  storage: Storage = globalThis.localStorage,
): void => {
  storage.removeItem(keyOf(email));
};
