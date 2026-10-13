import {
  useDisplays,
  useScreenRegion,
} from "@domicile-desktop/component-library/DisplayProvider";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { useEffect, useEffectEvent, useState } from "react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { Layer, layerStyles } from "./layer";
import { Photo } from "./Photo";
import { WALLPAPER_FALLBACKS, WALLPAPER_PHOTOS } from "./photos";

/** How long each photograph shows before the next fades in. */
const DWELL_MS = 60_000;

/**
 * How long the first photographs have to load before the photograph from the
 * repository shows. Shown at once, it would flash on every start.
 */
const FALLBACK_DELAY_MS = 3000;

/**
 * Crossfade duration in ms. Read from the same token as the CSS transition so
 * the two stay in sync.
 */
const CROSSFADE_MS = Number.parseFloat(token("durations.crossfade")) * 1000;

type Props = {
  /**
   * Holds the rotation, as while the theme wipe plays: a crossfade under it
   * would show through the new theme's frame. A photograph due meanwhile
   * fades in once released.
   */
  held?: boolean;
  /**
   * A picture an application set through the Wallpaper portal, as a URL. Shown
   * on every screen in place of the rotation.
   */
  picture?: string | undefined;
  /** The theme shown, whose rotation advances. */
  theme: Theme;
};

/** Each rotation's first step. */
const STARTS: Readonly<Record<Theme, number>> = { dark: 0, light: 0 };

/**
 * The desktop wallpaper: a photograph rotation that changes every minute, or
 * the picture an application set. See
 * `packages/shell-manganese/docs/WALLPAPER.md`.
 *
 * - Each screen gets its own copy, cropped to that monitor, so nothing is
 *   drawn in the gaps between monitors. The copies are not `<Screen>`s, which
 *   would add a second region per display and break lookups by
 *   `data-screen`.
 * - Every copy shows the same step, so the screens change together.
 * - Both themes' rotations stay mounted and CSS shows one, so a theme switch
 *   shows a loaded photograph and needs only the `data-theme` attribute. The
 *   shown rotation mounts only the photographs on screen and the next one.
 *   The other holds its photograph and loads no next one until it is shown.
 * - It takes no pointer events.
 */
export const Wallpaper = ({ held = false, picture, theme }: Props) => {
  const displays = useDisplays();
  const [steps, setSteps] = useState(STARTS);
  // Whether the shown rotation's fade has finished.
  const [settled, setSettled] = useState(true);
  // Whether a minute has passed since the last step.
  const [due, setDue] = useState(false);
  // Whether the photograph from the repository shows: once the first
  // photographs are late or one fails.
  const [fallback, setFallback] = useState(false);
  const showFallback = () => {
    setFallback(true);
  };
  // An effect event, so a theme switch does not advance the hidden rotation.
  const advance = useEffectEvent(() => {
    setSteps((previous) => ({ ...previous, [theme]: previous[theme] + 1 }));
    setSettled(false);
    setDue(false);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setDue(true);
    }, DWELL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFallback(true);
    }, FALLBACK_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (due && !held) {
      advance();
    }
  }, [due, held]);

  useEffect(() => {
    if (settled) {
      return;
    }
    const timer = setTimeout(() => {
      setSettled(true);
    }, CROSSFADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settled]);

  return (
    <div className={sheetStyles}>
      {displays === undefined ? (
        // The whole page until the host describes the screens, so the
        // desktop is not blank while it starts.
        <ScreenWallpaper
          fallback={fallback}
          onPhotoError={showFallback}
          picture={picture}
          screen={undefined}
          settled={settled}
          shown={theme}
          steps={steps}
        />
      ) : (
        displays.map(({ name }) => (
          <ScreenWallpaper
            fallback={fallback}
            key={name}
            onPhotoError={showFallback}
            picture={picture}
            screen={name}
            settled={settled}
            shown={theme}
            steps={steps}
          />
        ))
      )}
    </div>
  );
};

type RotationProps = {
  /** Whether the photograph from the repository shows. */
  fallback: boolean;
  /** Called when a photograph fails to load. */
  onPhotoError: () => void;
  /** Whether the shown rotation's fade has finished. */
  settled: boolean;
  /** The theme shown. */
  shown: Theme;
  /** Each theme's step. */
  steps: Readonly<Record<Theme, number>>;
};

/**
 * The rotation on display `screen`, or the whole page; or `picture` in its
 * place.
 */
const ScreenWallpaper = ({
  picture,
  screen,
  ...rotation
}: RotationProps & {
  picture: string | undefined;
  screen: string | undefined;
}) => (
  <div className={screenStyles} style={useScreenRegion(screen)}>
    {picture === undefined ? (
      <Rotation {...rotation} />
    ) : (
      // Empty `alt` because the wallpaper is decorative.
      <img
        alt=""
        className={layerStyles}
        data-wallpaper={Layer.Current}
        src={picture}
      />
    )}
  </div>
);

/**
 * Both themes' photographs at their steps, over each theme's photograph from
 * the repository once `fallback`.
 */
const Rotation = ({
  fallback,
  onPhotoError,
  settled,
  shown,
  steps,
}: RotationProps) => (
  <>
    {THEMES.map((theme) => (
      <div
        className={rotationStyles[theme]}
        data-wallpaper-theme={theme}
        key={theme}
      >
        {/* Empty `alt` because the wallpaper is decorative. The role is an
            attribute so one stylesheet covers all states and tests can read
            it. */}
        <img
          alt=""
          className={layerStyles}
          data-wallpaper={fallback ? Layer.Fallback : Layer.Waiting}
          src={WALLPAPER_FALLBACKS[theme]}
        />
        {WALLPAPER_PHOTOS[theme].map((photo, index, photos) =>
          isMounted(
            index,
            steps[theme],
            photos.length,
            settled,
            theme === shown,
          ) ? (
            <Photo
              key={photo}
              layer={layerOf(
                index,
                steps[theme],
                photos.length,
                settled || theme !== shown,
              )}
              onError={onPhotoError}
              src={photo}
            />
          ) : undefined,
        )}
      </div>
    ))}
  </>
);

/**
 * Whether the photograph at `index` is mounted on this `step`: it is on
 * screen, fading out, or next in the `shown` rotation. The next one mounts a
 * whole step early so it has loaded before it fades in. The rest stay
 * unmounted, so the page does not hold every 4K photograph at once. A hidden
 * rotation mounts only its photograph on screen, which does not change.
 */
const isMounted = (
  index: number,
  step: number,
  length: number,
  settled: boolean,
  shown: boolean,
): boolean =>
  shown
    ? index === (step + 1) % length ||
      layerOf(index, step, length, settled) !== Layer.Waiting
    : index === step % length;

/**
 * The role of the photograph at `index` on this `step` of the rotation.
 *
 * At step 0 the previous index is `-1 % n`, which is `-1` and matches no
 * photograph. Once `settled`, there is no previous layer.
 */
const layerOf = (
  index: number,
  step: number,
  length: number,
  settled: boolean,
): Layer => {
  if (index === step % length) {
    return Layer.Current;
  } else if (!settled && index === (step - 1) % length) {
    return Layer.Previous;
  } else {
    return Layer.Waiting;
  }
};

const sheetStyles = css({
  inset: 0,
  // Scopes the layers' `z-index` here. Otherwise the current layer would
  // stack in the page's context, over the chrome and level with floats.
  isolation: "isolate",
  pointerEvents: "none",
  // The viewport is sized to the whole desktop, so the screens' page-space
  // regions land on their monitors.
  position: "fixed",
  // The depth of a tab a tab switch is hiding (`COVERED` in `placement.ts`).
  // It comes later in the document, so it draws over the wallpaper. Higher,
  // the wallpaper would show through a window opening or closing in front.
  zIndex: -2,
});

// The whole sheet, narrowed to a monitor by the region from
// `useScreenRegion`.
const screenStyles = css({
  inset: 0,
  position: "absolute",
});

// `contents` keeps the layers positioned and stacked against the screen.
const rotationStyles: Record<Theme, string> = {
  dark: css({ _light: { display: "none" } }),
  light: css({ _light: { display: "contents" }, display: "none" }),
};
