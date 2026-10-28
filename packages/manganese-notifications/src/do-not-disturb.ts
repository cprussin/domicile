// Do not disturb, stored locally so a reload keeps it. Every page of the
// desktop shares one origin, so they read the same value.

/** The storage key, versioned per the persisted-state rule. */
const KEY = "do-not-disturb:v1";

/** Whether do not disturb was left on. Any other stored value counts as off. */
export const storedDoNotDisturb = (): boolean =>
  globalThis.localStorage.getItem(KEY) === "on";

/** Store `on` for other pages and future loads. */
export const storeDoNotDisturb = (on: boolean): void => {
  if (on) {
    globalThis.localStorage.setItem(KEY, "on");
  } else {
    globalThis.localStorage.removeItem(KEY);
  }
};
