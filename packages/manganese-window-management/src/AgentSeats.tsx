import { Button } from "@domicile-desktop/component-library/Button";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { useEffect, useRef, useState } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { AGENT_POINTER, raised } from "./placement";
import type { Rect } from "./rect";
import { TITLE_BAR } from "./rect";
import { useLingering } from "./useLingering";
import { placedAt } from "./window-styles";

/** A window on screen, which an agent can hold or the user take. */
export type HoldableWindow = {
  /**
   * The id seats name it by: its client's app id, or the engine's id for a
   * browser window.
   */
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
  /** The windows on screen and at rest. */
  windows: readonly HoldableWindow[];
};

/**
 * What agents beside the user are doing, drawn over their windows:
 *
 * - a violet ring and the agent's name around each window it uses,
 * - an amber ring, "Paused" on its name, and a banner under the title bar on
 *   each window the user took from it, which gives it back,
 * - and its pointer, named, while over one of them; gray where it is paused.
 *
 * Each ring and banner sits at its window's raised depth, so it covers its
 * window and the windows stacked above stay above. The pointers go over
 * everything, as the user's own does.
 *
 * Rings fade in and out and turn amber in place; banners slide down from
 * under the title bar and back up.
 */
export const AgentSeats = ({ onGiveBack, seats, windows }: Props) => {
  const byApp = new Map(windows.map((window) => [window.appId, window]));
  const onScreen = (appId: string): boolean => byApp.has(appId);

  const marks = useLingering(
    seats.flatMap((seat) =>
      [...new Set([...seat.holds, ...seat.taken])]
        .filter((appId) => onScreen(appId))
        .map((appId) => ({
          appId,
          key: `${seat.id}:${appId}`,
          name: seat.name,
          paused: seat.taken.includes(appId),
        })),
    ),
    keyOf,
  );

  // Hidden banners, until their window is given back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_KEYS);
  const taken = new Set(
    seats.flatMap((seat) => seat.taken.map((appId) => `${seat.id}:${appId}`)),
  );
  if ([...hidden].some((key) => !taken.has(key))) {
    setHidden(new Set([...hidden].filter((key) => taken.has(key))));
  }
  const banners = useLingering(
    seats.flatMap((seat) =>
      seat.taken
        .filter((appId) => onScreen(appId))
        .map((appId) => ({
          appId,
          key: `${seat.id}:${appId}`,
          name: seat.name,
        }))
        .filter(({ key }) => !hidden.has(key)),
    ),
    keyOf,
  );

  return (
    <>
      {marks.shown.map(({ item, leaving }) => {
        const window = byApp.get(item.appId);
        return (
          window !== undefined && (
            <Ring
              key={item.key}
              leaving={leaving}
              name={item.name}
              onLeft={() => {
                marks.left(item.key);
              }}
              paused={item.paused}
              window={window}
            />
          )
        );
      })}
      {banners.shown.map(({ item, leaving }) => {
        const window = byApp.get(item.appId);
        return (
          window !== undefined && (
            <Banner
              giveBack={() => {
                onGiveBack(item.appId);
              }}
              hide={() => {
                setHidden((before) => new Set([...before, item.key]));
              }}
              key={item.key}
              leaving={leaving}
              name={item.name}
              onLeft={() => {
                banners.left(item.key);
              }}
              window={window}
            />
          )
        );
      })}
      {seats.map(({ holds, id, name, pointer, taken: paused }) => {
        if (pointer === undefined) {
          return undefined;
        }
        const over = (appIds: readonly string[]) =>
          appIds.some((appId) => {
            const window = byApp.get(appId);
            return window !== undefined && contains(window.frame, pointer);
          });
        const dim = over(paused);
        return dim || over(holds) ? (
          <Pointer at={pointer} dim={dim} key={id} name={name} />
        ) : undefined;
      })}
    </>
  );
};

const keyOf = ({ key }: { key: string }): string => key;

const NO_KEYS: ReadonlySet<string> = new Set();

/** How long a leaving ring or banner may take before it goes regardless. */
const LEAVE_MS = 1000;

/**
 * Calls `onLeft` once `leaving` has lasted {@link LEAVE_MS}, in case its
 * transition never ends, such as on a window that stopped being drawn.
 */
const useLeftAnyway = (leaving: boolean, onLeft: () => void) => {
  const latest = useRef(onLeft);
  latest.current = onLeft;
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const timer = setTimeout(() => {
      latest.current();
    }, LEAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);
};

/** A spot in the page's CSS pixels, which are the desk's. */
type Spot = { readonly x: number; readonly y: number };

/** Whether `spot` is in `rect`, which holds its left and top edges only. */
const contains = (rect: Rect, spot: Spot): boolean =>
  spot.x >= rect.x &&
  spot.x < rect.x + rect.width &&
  spot.y >= rect.y &&
  spot.y < rect.y + rect.height;

/**
 * A ring around a window an agent uses, with the agent's name on its edge:
 * violet while the agent drives it, amber while the user has taken it.
 */
const Ring = ({
  leaving,
  name,
  onLeft,
  paused,
  window,
}: {
  leaving: boolean;
  name: string;
  onLeft: () => void;
  paused: boolean;
  window: HoldableWindow;
}) => {
  useLeftAnyway(leaving, onLeft);
  return (
    <div
      className={ringStyles}
      data-agent-ring={window.appId}
      data-leaving={leaving ? "" : undefined}
      data-paused={paused ? "" : undefined}
      onTransitionEnd={(event) => {
        if (
          leaving &&
          event.target === event.currentTarget &&
          event.propertyName === "opacity"
        ) {
          onLeft();
        }
      }}
      style={placedAt(window.frame, raised(window.depth))}
    >
      <span className={tagStyles}>
        {paused ? (
          <PauseIcon aria-hidden size={13} weight="fill" />
        ) : (
          <RobotIcon aria-hidden size={13} weight="bold" />
        )}
        {paused ? `${name} · Paused` : name}
      </span>
    </div>
  );
};

/**
 * Under the title bar of a window the user took from an agent: it is the
 * user's until they give it back. Hiding it keeps the window the user's, and
 * the amber ring says so still.
 */
const Banner = ({
  giveBack,
  hide,
  leaving,
  name,
  onLeft,
  window,
}: {
  giveBack: () => void;
  hide: () => void;
  leaving: boolean;
  name: string;
  onLeft: () => void;
  window: HoldableWindow;
}) => {
  useLeftAnyway(leaving, onLeft);
  const { frame } = window;
  return (
    // The window below its title bar, clipping the banner as it slides out
    // from under the bar.
    <div
      className={bannerClipStyles}
      style={placedAt(
        {
          ...frame,
          height: Math.max(0, frame.height - TITLE_BAR),
          y: frame.y + TITLE_BAR,
        },
        raised(window.depth),
      )}
    >
      <div
        className={bannerStyles}
        data-leaving={leaving ? "" : undefined}
        // Dark tokens on the amber, whatever the theme.
        data-tone="overPhoto"
        inert={leaving}
        onTransitionEnd={(event) => {
          if (
            leaving &&
            event.target === event.currentTarget &&
            event.propertyName === "translate"
          ) {
            onLeft();
          }
        }}
        role="status"
      >
        <PauseIcon aria-hidden className={bannerIconStyles} weight="fill" />
        <span className={bannerTextStyles}>
          <strong>You're using this window</strong>
          <span>{`${name} is paused here until you give it back.`}</span>
        </span>
        <span className={bannerButtonsStyles}>
          <Button
            label={`Give back to ${name}`}
            onClick={giveBack}
            size="sm"
            variant="solid"
          >
            Give back
          </Button>
          <Button onClick={hide} size="sm" variant="ghost">
            Hide
          </Button>
        </span>
      </div>
    </div>
  );
};

/**
 * An agent's pointer: a violet arrow with its name, which takes no pointer;
 * gray over a window the user took from it, where it waits.
 */
const Pointer = ({
  at,
  dim,
  name,
}: {
  at: Spot;
  dim: boolean;
  name: string;
}) => (
  <div
    className={pointerStyles}
    data-agent-pointer
    data-paused={dim ? "" : undefined}
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

// Outer rings only, which leave the client's pixels alone, like the focus
// glow. Violet and amber each on its own layer, crossfading by opacity, so
// turning amber stays on the compositor. The violet is brighter in the dark
// theme, where the fill's violet is too deep to read on a dark wallpaper.
const ringStyles = css({
  _starting: { opacity: 0 },
  "&::after": {
    borderRadius: "lg",
    boxShadow: "0 0 0 {spacing.0.5} {colors.agentPaused}",
    content: '""',
    inset: 0,
    opacity: 0,
    position: "absolute",
    transition: "opacity {durations.normal} {easings.out}",
  },
  "&::before": {
    borderRadius: "lg",
    boxShadow: {
      _light: "0 0 0 {spacing.0.5} {colors.agent}",
      base: "0 0 0 {spacing.0.5} color-mix(in oklab, {colors.agent} 70%, white)",
    },
    content: '""',
    inset: 0,
    position: "absolute",
    transition: "opacity {durations.normal} {easings.out}",
  },
  "&[data-leaving]": {
    opacity: 0,
    transition: "opacity {durations.fast} {easings.in}",
  },
  "&[data-paused]::after": { opacity: 1 },
  "&[data-paused]::before": { opacity: 0 },
  opacity: 1,
  pointerEvents: "none",
  transition: "opacity {durations.normal} {easings.out}",
});

// Straddling the ring's top edge, in its middle, clear of the title and the
// buttons at the bar's ends. It pops in, and turns amber with its ring.
const tagStyles = hstack({
  _starting: { scale: "0.8" },
  "[data-paused] > &": { backgroundColor: "agentPaused" },
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
  scale: "1",
  transform: "translate(-50%, -50%)",
  transition:
    "background-color {durations.normal} {easings.default}, scale {durations.springs.bouncy} {easings.springs.bouncy}",
  whiteSpace: "nowrap",
  zIndex: 1,
});

// The window under its title bar, passing the pointer through but for the
// banner.
const bannerClipStyles = css({
  borderEndEndRadius: "lg",
  borderEndStartRadius: "lg",
  overflow: "clip",
  pointerEvents: "none",
});

// Slides down from under the title bar on a spring, and back up quicker.
const bannerStyles = hstack({
  _starting: { opacity: 0, translate: "0 -100%" },
  "&[data-leaving]": {
    opacity: 0,
    transition:
      "opacity {durations.fast} {easings.in}, translate {durations.springs.snappy} {easings.springs.snappy}",
    translate: "0 -100%",
  },
  backgroundColor: "agentPaused",
  boxShadow: "lifted",
  color: "onAgent",
  fontSize: "sm",
  gap: 2.5,
  opacity: 1,
  paddingBlock: 2,
  paddingInline: 3,
  pointerEvents: "auto",
  transition:
    "opacity {durations.normal} {easings.out}, translate {durations.springs.smooth} {easings.springs.smooth}",
  translate: "0 0",
});

// Hide in white on the amber, as the banner's text is; the ghost's own gray
// is too faint there.
const bannerButtonsStyles = hstack({
  "& button:last-child": { color: "onAgent" },
  flexShrink: 0,
  gap: 1,
  whiteSpace: "nowrap",
});

const bannerIconStyles = css({ blockSize: 5, flexShrink: 0, inlineSize: 5 });

const bannerTextStyles = flex({
  direction: "column",
  flexGrow: 1,
  lineHeight: "tight",
  minInlineSize: 0,
});

const pointerStyles = hstack({
  alignItems: "flex-start",
  gap: 0.5,
  pointerEvents: "none",
  position: "absolute",
});

const arrowStyles = css({
  "[data-paused] > &": { fill: "neutral.400" },
  blockSize: 4.5,
  fill: "agent",
  flexShrink: 0,
  inlineSize: 4.5,
  stroke: "onAgent",
  strokeLinejoin: "round",
  strokeWidth: "1.4",
});

const nameStyles = css({
  "[data-paused] > &": { backgroundColor: "neutral.500" },
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
