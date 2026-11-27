// IPC's values as the engine carries them between the app and its pages:
// JSON, with each run of bytes as an object of one key, BYTES, holding them
// in base64. Electron's structured clone carries bytes, and VS Code's IPC is
// nothing but bytes, so a JSON trip alone would hand it `{"0": 1, ...}`.

/** The one key of a run of bytes on the wire; the engine's preload uses it too. */
const BYTES = "$domicileBytes";

/**
 * `value` as it goes to a page: what JSON carries, with each Buffer, typed
 * array, DataView or ArrayBuffer in it as a run of bytes, which the page
 * gets as a Uint8Array.
 */
export const toWire = (value: unknown): unknown =>
  JSON.parse(JSON.stringify([withBytesTagged(value)]))[0];

/** `values`, each as it goes to a page. */
export const allToWire = (values: readonly unknown[]): unknown[] =>
  values.map(toWire);

/**
 * `value` as a page sent it, each run of bytes in it a Buffer, as Electron's
 * main process gets a page's bytes.
 */
export const fromWire = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(fromWire);
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const [only] = entries;
    if (
      entries.length === 1 &&
      only !== undefined &&
      only[0] === BYTES &&
      typeof only[1] === "string"
    ) {
      return Buffer.from(only[1], "base64");
    } else {
      return Object.fromEntries(
        entries.map(([key, each]) => [key, fromWire(each)]),
      );
    }
  } else {
    return value;
  }
};

/** `values`, each as a page sent it. */
export const allFromWire = (values: readonly unknown[]): unknown[] =>
  values.map(fromWire);

/** `value` with its runs of bytes tagged, ahead of JSON's own `toJSON`s. */
const withBytesTagged = (value: unknown): unknown => {
  if (value instanceof ArrayBuffer) {
    return { [BYTES]: Buffer.from(value).toString("base64") };
  } else if (ArrayBuffer.isView(value)) {
    return {
      [BYTES]: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString("base64"),
    };
  } else if (Array.isArray(value)) {
    return value.map(withBytesTagged);
  } else if (value !== null && typeof value === "object") {
    return "toJSON" in value && typeof value.toJSON === "function"
      ? withBytesTagged(value.toJSON())
      : Object.fromEntries(
          Object.entries(value).map(([key, each]) => [
            key,
            withBytesTagged(each),
          ]),
        );
  } else {
    return value;
  }
};
