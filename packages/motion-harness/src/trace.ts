// The animations in a Chromium trace of the `devtools.timeline` category, and
// whether each ran on the compositor.

import { z } from "zod";

/** An animation the page ran, and why it ran on the main thread, if it did. */
export type TracedAnimation = {
  /** The element, as Chromium names it: tag, id and classes. */
  element: string;
  failed: AnimationFailure | undefined;
  /** The animated property, or the animation's name. */
  property: string;
};

/**
 * Why the compositor did not take an animation: Blink's
 * `CompositorAnimations::FailureReason` bits, and the properties it cannot
 * animate.
 */
export type AnimationFailure = {
  reasons: number;
  unsupported: readonly string[];
};

/**
 * Every animation `trace` started, in the order they started.
 *
 * An animation's events share an id from its start (`b`) to its end (`e`).
 * Chromium reuses an id once its animation ends.
 */
export const animationsIn = (trace: unknown): TracedAnimation[] => {
  const events = traceSchema
    .parse(trace)
    .traceEvents.flatMap((event) =>
      event.name === "Animation" ? [animationEventSchema.parse(event)] : [],
    );
  return events.flatMap(({ args, id2, ph }, at) =>
    ph === "b"
      ? [
          {
            element: args.data?.nodeName ?? "",
            failed: failureOf(events.slice(at + 1), id2.local),
            property: args.data?.displayName ?? "",
          },
        ]
      : [],
  );
};

const traceSchema = z.object({
  traceEvents: z.array(z.object({ name: z.string() }).loose()),
});

const animationEventSchema = z.object({
  args: z.object({
    data: z
      .object({
        compositeFailed: z.number().optional(),
        displayName: z.string().optional(),
        nodeName: z.string().optional(),
        unsupportedProperties: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  id2: z.object({ local: z.string() }),
  ph: z.string(),
});

type AnimationEvent = z.infer<typeof animationEventSchema>;

/** The failure of animation `local` among the events `later` than its start. */
const failureOf = (
  later: readonly AnimationEvent[],
  local: string,
): AnimationFailure | undefined => {
  const own = later.filter(({ id2 }) => id2.local === local);
  const ended = own.findIndex(({ ph }) => ph === "e");
  const failed = (ended === -1 ? own : own.slice(0, ended)).find(
    ({ args }) => args.data?.compositeFailed !== undefined,
  )?.args.data;
  return failed?.compositeFailed === undefined
    ? undefined
    : {
        reasons: failed.compositeFailed,
        unsupported: failed.unsupportedProperties ?? [],
      };
};
