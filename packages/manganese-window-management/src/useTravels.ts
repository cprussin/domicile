import { useLayoutEffect, useMemo, useState } from "react";

import type { Rect } from "./rect";
import type { Travel } from "./travel";
import { chipFor, travelTo } from "./travel";
import type { DrawnWindow } from "./useWindowMotion";
import { WindowKind } from "./window";

/**
 * Where each window travels as it opens or leaves, by id. See `traveled`.
 *
 * - A dialog opening grows out of the middle of the window it is for, when
 *   that window is drawn on its screen.
 * - A window sent to another workspace flies into the workspace's chip in the
 *   bar (`workspaceOf` names it), sized to fit inside it. The chip is measured
 *   once, as the window sets out, and never while nothing is sent.
 *
 * Any other window grows or shrinks in place.
 */
export const useTravels = (
  drawn: readonly DrawnWindow[],
  workspaceOf: (id: string) => string | undefined,
): ReadonlyMap<string, Travel> => {
  const opened = useMemo(() => openedFrom(drawn), [drawn]);
  const [sent, setSent] = useState<ReadonlyMap<string, Travel>>(NONE);
  // Before paint, so the window sets out on its path from its first frame.
  useLayoutEffect(() => {
    const next = new Map(
      drawn.flatMap(({ motion, placement, window }) => {
        if (
          (motion === "sending" || motion === "sending-tab") &&
          placement !== undefined
        ) {
          const travel =
            sent.get(window.id) ??
            towardsChip(placement.frame, workspaceOf(window.id));
          return travel === undefined ? [] : [[window.id, travel] as const];
        } else {
          return [];
        }
      }),
    );
    if (!sameTravels(sent, next)) {
      setSent(next);
    }
  }, [drawn, sent, workspaceOf]);
  return useMemo(() => new Map([...opened, ...sent]), [opened, sent]);
};

const NONE: ReadonlyMap<string, Travel> = new Map();

/** Each opening dialog's travel from the window it is for. */
const openedFrom = (
  drawn: readonly DrawnWindow[],
): ReadonlyMap<string, Travel> => {
  const placed = new Map(drawn.map((entry) => [entry.window.id, entry]));
  return new Map(
    drawn.flatMap(({ motion, placement, screen, window }) => {
      const opener =
        window.kind === WindowKind.App && window.opener !== undefined
          ? placed.get(window.opener)
          : undefined;
      return motion === "opening" &&
        placement !== undefined &&
        opener?.placement !== undefined &&
        opener.screen === screen
        ? [
            [
              window.id,
              travelTo(placement.frame, opener.placement.frame, false),
            ] as const,
          ]
        : [];
    }),
  );
};

/** The travel from `frame` into workspace `name`'s chip, if a bar shows it. */
const towardsChip = (
  frame: Rect,
  name: string | undefined,
): Travel | undefined => {
  const chip = name === undefined ? undefined : chipFor(name);
  return chip === undefined
    ? undefined
    : travelTo(frame, chip.getBoundingClientRect(), true);
};

const sameTravels = (
  one: ReadonlyMap<string, Travel>,
  other: ReadonlyMap<string, Travel>,
): boolean =>
  one.size === other.size &&
  [...one].every(([id, travel]) => other.get(id) === travel);
