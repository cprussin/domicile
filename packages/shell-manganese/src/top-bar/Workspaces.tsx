import { Button } from "@domicile/component-library/Button";

import { hstack } from "../../styled-system/patterns";
import { WORKSPACES } from "../window-management/window-state";

type Props = {
  /** The workspace on screen. */
  current: string;
  /** The workspaces with something on them. */
  occupied: readonly string[];
  onSelect: (name: string) => void;
};

/**
 * The workspaces, at the left-hand end of the bar — sway's own bar, and the
 * same rule for which of them are on it: the ones with windows on them, and
 * the one being looked at whether or not it has any.
 *
 * The desktop keeps all ten all the time, which is the one place that
 * difference from sway would show. It does not show: an empty workspace
 * nobody is looking at is not here either.
 */
export const Workspaces = ({ current, occupied, onSelect }: Props) => (
  <nav aria-label="Workspaces" className={listStyles}>
    {WORKSPACES.filter(
      (name) => name === current || occupied.includes(name),
    ).map((name) => (
      <Button
        // The pressed one is the one on screen, which is what `aria-current`
        // says on a navigation control — `disabled` would say it cannot be
        // reached, and pressing it is how `workspaceAutoBackAndForth` goes
        // back to the last one.
        aria-current={name === current ? "true" : undefined}
        key={name}
        onClick={() => {
          onSelect(name);
        }}
        size="sm"
        variant={name === current ? "accent" : "ghost"}
      >
        {name}
      </Button>
    ))}
  </nav>
);

const listStyles = hstack({ gap: 0.5 });
