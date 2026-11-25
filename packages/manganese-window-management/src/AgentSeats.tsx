import { Button } from "@domicile-desktop/component-library/Button";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { useState } from "react";

import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";
import { AGENT_POINTER, raised } from "./placement";
import type { Rect } from "./rect";
import { placedAt } from "./window-styles";

/** A client window on screen, which an agent can hold or the user take. */
export type HoldableWindow = {
  /** The host's id for its client, which seats name. */
  appId: string;
  /** Its `z-index`. */
  depth: number;
  /** Its title bar and contents. */
  frame: Rect;
};

type Props = {
  /** Lets agents drive window `appId` again. See `Seats.giveBack`. */
  onGiveBack: (appId: string) => void;
  /** Every agent's seat. */
  seats: readonly Seat[];
  /** The client windows on screen and at rest. */
  windows: readonly HoldableWindow[];
};

/**
 * What agents beside the user are doing, drawn over their windows:
 *
 * - a ring and the agent's name around each window it uses,
 * - its pointer, named, while over one of them,
 * - and a strip on each window the user took from it, which gives it back.
 *
 * Each ring and strip sits at its window's raised depth, so it covers its
 * window and the windows stacked above stay above. The pointers go over
 * everything, as the user's own does.
 */
export const AgentSeats = ({ onGiveBack, seats, windows }: Props) => {
  const byApp = new Map(windows.map((window) => [window.appId, window]));
  const on = (appIds: readonly string[]): readonly HoldableWindow[] =>
    appIds.flatMap((appId) => byApp.get(appId) ?? []);
  return (
    <>
      {seats.flatMap((seat) =>
        on(seat.holds.filter((appId) => !seat.taken.includes(appId))).map(
          (window) => (
            <Ring
              key={`${seat.id}:${window.appId}`}
              seat={seat}
              window={window}
            />
          ),
        ),
      )}
      {seats.flatMap((seat) =>
        on(seat.taken).map((window) => (
          <YoursNow
            giveBack={() => {
              onGiveBack(window.appId);
            }}
            key={`${seat.id}:${window.appId}`}
            seat={seat}
            window={window}
          />
        )),
      )}
      {seats.map(({ holds, id, name, pointer }) =>
        pointer !== undefined &&
        on(holds).some(({ frame }) => contains(frame, pointer)) ? (
          <Pointer at={pointer} key={id} name={name} />
        ) : undefined,
      )}
    </>
  );
};

/** A spot in the page's CSS pixels, which are the desk's. */
type Spot = { readonly x: number; readonly y: number };

/** Whether `spot` is in `rect`, which holds its left and top edges only. */
const contains = (rect: Rect, spot: Spot): boolean =>
  spot.x >= rect.x &&
  spot.x < rect.x + rect.width &&
  spot.y >= rect.y &&
  spot.y < rect.y + rect.height;

/** A ring around a window an agent uses, with the agent's name on its edge. */
const Ring = ({ seat, window }: { seat: Seat; window: HoldableWindow }) => (
  <div
    className={ringStyles}
    data-agent-ring={window.appId}
    style={placedAt(window.frame, raised(window.depth))}
  >
    <span className={tagStyles}>
      <RobotIcon aria-hidden size={13} weight="bold" />
      {seat.name}
    </span>
  </div>
);

/**
 * Along the bottom of a window the user took from an agent: it is the user's
 * until they give it back. Closing it keeps the window the user's.
 */
const YoursNow = ({
  giveBack,
  seat,
  window,
}: {
  giveBack: () => void;
  seat: Seat;
  window: HoldableWindow;
}) => {
  const [closed, setClosed] = useState(false);
  return closed ? undefined : (
    <div
      className={stripStyles}
      style={placedAt(window.frame, raised(window.depth))}
    >
      <div className={stripBarStyles}>
        <span className={stripTextStyles}>Yours now</span>
        <Button
          label={`Give back to ${seat.name}`}
          onClick={giveBack}
          size="sm"
          variant="primary"
        >
          Give back
        </Button>
        <Button
          onClick={() => {
            setClosed(true);
          }}
          size="sm"
          variant="ghost"
        >
          Close
        </Button>
      </div>
    </div>
  );
};

/** An agent's pointer: a violet arrow with its name, which takes no pointer. */
const Pointer = ({ at, name }: { at: Spot; name: string }) => (
  <div
    className={pointerStyles}
    data-agent-pointer
    style={{
      insetBlockStart: `${String(at.y)}px`,
      insetInlineStart: `${String(at.x)}px`,
      zIndex: AGENT_POINTER,
    }}
  >
    <svg aria-hidden className={arrowStyles} viewBox="0 0 24 24">
      <path d="M4 2l14 10-6.5 1.2L15 21l-3 1.3-3.4-7.7L4 19z" />
    </svg>
    <span className={nameStyles}>{name}</span>
  </div>
);

// An outer ring only, which leaves the client's pixels alone, like the focus
// glow; brighter in the dark theme, where the fill's violet is too deep to
// read on a dark wallpaper.
const ringStyles = css({
  borderRadius: "lg",
  boxShadow: {
    _light: "0 0 0 {spacing.0.5} {colors.agent}",
    base: "0 0 0 {spacing.0.5} color-mix(in oklab, {colors.agent} 70%, white)",
  },
  pointerEvents: "none",
});

// Straddling the ring's top edge, in its middle, clear of the title and the
// buttons at the bar's ends.
const tagStyles = hstack({
  backgroundColor: "agent",
  blockSize: 5,
  borderRadius: "full",
  color: "onAgent",
  fontSize: "xs",
  fontWeight: "semibold",
  gap: 1,
  insetBlockStart: 0,
  insetInlineStart: "50%",
  paddingInline: 2,
  position: "absolute",
  transform: "translate(-50%, -50%)",
  whiteSpace: "nowrap",
});

// The window's box, passing the pointer through but for its bar.
const stripStyles = css({
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  pointerEvents: "none",
});

const stripBarStyles = hstack({
  backgroundColor:
    "color-mix(in oklab, {colors.agent} 14%, {colors.background})",
  borderBlockStart: "1px solid {colors.border}",
  borderEndEndRadius: "lg",
  borderEndStartRadius: "lg",
  color: "foreground",
  fontSize: "sm",
  gap: 2,
  paddingBlock: 1.5,
  paddingInline: 2,
  pointerEvents: "auto",
});

const stripTextStyles = css({ flexGrow: 1 });

const pointerStyles = hstack({
  alignItems: "flex-start",
  gap: 0.5,
  pointerEvents: "none",
  position: "absolute",
});

const arrowStyles = css({
  blockSize: 4.5,
  fill: "agent",
  flexShrink: 0,
  inlineSize: 4.5,
  stroke: "onAgent",
  strokeLinejoin: "round",
  strokeWidth: "1.4",
});

const nameStyles = css({
  backgroundColor: "agent",
  borderRadius: "full",
  color: "onAgent",
  fontSize: "xs",
  fontWeight: "semibold",
  marginBlockStart: 3.5,
  marginInlineStart: -1,
  paddingInline: 1.5,
  whiteSpace: "nowrap",
});
