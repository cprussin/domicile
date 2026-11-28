import type { ComponentProps, KeyboardEvent, RefObject } from "react";

import { Input } from "../Input/Input";
import { pageOf, stepOf, steppedTo } from "../list-walk";
import { resultId } from "../ResultList/ResultList";
import "../stylesheet";

// Omits from each member of a union, keeping `Input`'s either/or suffix.
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Props = Without<
  ComponentProps<typeof Input>,
  | "aria-activedescendant"
  | "aria-controls"
  | "aria-expanded"
  | "onKeyDown"
  | "role"
  | "spellCheck"
> & {
  /** The highlighted row, or none for an empty list. */
  highlighted: number | undefined;
  /** The list's id, whose rows carry {@link resultId}s. */
  listId: string;
  /** How many rows the list holds. */
  count: number;
  /** The list's scroller, which sets how far a page key moves. */
  scroller: RefObject<HTMLElement | null>;
  /** Moves the highlight to row `at`. */
  onStep: (at: number) => void;
  /** Any key that doesn't move the highlight. */
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
};

/**
 * A box that filters the list below it, and walks that list's highlight with
 * the keys `stepOf` knows while focus stays in the box: the launcher, the
 * clipboard history and the file picker.
 *
 * What's typed is names, paths and copies rather than prose, so it isn't
 * spell checked.
 */
export const ListFilter = ({
  count,
  highlighted,
  listId,
  onKeyDown,
  onStep,
  scroller,
  ...props
}: Props) => (
  <Input
    {...props}
    aria-activedescendant={
      highlighted === undefined ? undefined : resultId(listId, highlighted)
    }
    aria-controls={listId}
    aria-expanded
    onKeyDown={(event) => {
      // An empty list may not be mounted to measure, and has no page.
      const step = stepOf(event, count === 0 ? 1 : pageOf(scroller.current));
      if (step === undefined) {
        onKeyDown?.(event);
      } else {
        // Stop the box from moving the caret.
        event.preventDefault();
        if (count > 0) {
          // Step from the clamped highlight, since the caller's step may be
          // past the end of a narrowed list.
          onStep(steppedTo(highlighted ?? 0, step, count));
        }
      }
    }}
    role="combobox"
    spellCheck={false}
  />
);
