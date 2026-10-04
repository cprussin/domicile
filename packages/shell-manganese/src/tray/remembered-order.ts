import { z } from "zod";

// The user's tray icon order, stored locally. The compositor and engine each
// send icons in their own order. Every page of the desktop shares one origin,
// so they read the same stored order.

/** The storage key, versioned per the persisted-state rule. */
export const ORDER_KEY = "tray-order:v1";

const orderSchema = z.array(z.string());

/**
 * The stored tray order, as `trayKey` keys, or none if nothing is stored.
 *
 * Parsed rather than cast: an unreadable value counts as no order, and the tray
 * uses arrival order until the user drags an icon.
 */
export const rememberedOrder = (): readonly string[] => {
  const stored = globalThis.localStorage.getItem(ORDER_KEY);
  return stored === null ? [] : parseOrder(stored);
};

/** Store the order for other pages and future loads. */
export const rememberOrder = (order: readonly string[]): void => {
  globalThis.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
};

/** `stored` as an order, or none if it is not one. */
export const parseOrder = (stored: string): readonly string[] =>
  storedOrderSchema.safeParse(stored).data ?? [];

// Invalid JSON is a parse issue, not a throw, so it is handled like any other
// invalid value.
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
