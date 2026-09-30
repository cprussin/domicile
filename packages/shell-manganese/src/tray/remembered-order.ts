import { z } from "zod";

// The order of the tray's icons, which is the user's and is nobody else's to
// keep: the compositor sends the icons, and the engine the extensions, each in
// an order of its own. So this page writes it down, and every page of the desk
// reads the same one — they are one origin.

/** Where the order is kept, suffixed per the versioning rule for persisted state. */
export const ORDER_KEY = "tray-order:v1";

const orderSchema = z.array(z.string());

/**
 * The order the user last put the tray in, as the keys `trayKey` makes, or
 * none at all on a machine that has not seen one.
 *
 * Parsed rather than cast, because anything can be under the key: a value
 * this build cannot read is no order, and the tray falls back to the order the
 * icons arrived in until the user drags one.
 */
export const rememberedOrder = (): readonly string[] => {
  const stored = globalThis.localStorage.getItem(ORDER_KEY);
  return stored === null ? [] : parseOrder(stored);
};

/** Write the order down, for the other pages and the next load. */
export const rememberOrder = (order: readonly string[]): void => {
  globalThis.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
};

/** `stored` as an order, or none when it is not one. */
export const parseOrder = (stored: string): readonly string[] =>
  storedOrderSchema.safeParse(stored).data ?? [];

// JSON that is not JSON is an issue of the parse rather than a throw, so a
// mangled value is no order like any other value that is not one.
const storedOrderSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(orderSchema);
