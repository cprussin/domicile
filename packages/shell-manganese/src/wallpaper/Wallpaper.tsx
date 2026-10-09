import {
  useDisplays,
  useScreenRegion,
} from "@domicile-desktop/component-library/DisplayProvider";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { Layer, layerStyles } from "./layer";
import { Photo } from "./Photo";
import { WALLPAPER_FALLBACKS, WALLPAPER_PHOTOS } from "./photos";

/** How long each photograph shows before the next fades in. */
const DWELL_MS = 60_000;

/**
 * Crossfade duration in ms. Read from the same token as the CSS transition so
 * the two stay in sync.
 */
const CROSSFADE_MS = Number.parseFloat(token("durations.crossfade")) * 1000;

type Props = {
  /**
   * A picture an application set through the Wallpaper portal, as a URL. Shown
   * on every screen in place of the rotation.
   */
  picture?: string | undefined;
};

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
 *   shows loaded photographs and needs only the `data-theme` attribute. Each
 *   rotation mounts only the photographs on screen and the next one.
 * - It takes no pointer events.
 */
export const Wallpaper = ({ picture }: Props) => {
  const displays = useDisplays();
  const [step, setStep] = useState(0);
  // Whether this step's fade has finished.
  const [settled, setSettled] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((previous) => previous + 1);
      setSettled(false);
    }, DWELL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

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
          picture={picture}
          screen={undefined}
          settled={settled}
          step={step}
        />
      ) : (
        displays.map(({ name }) => (
          <ScreenWallpaper
            key={name}
            picture={picture}
            screen={name}
            settled={settled}
            step={step}
          />
        ))
      )}
    </div>
  );
};

/**
 * The rotation on display `screen`, or the whole page, at `step`; or
 * `picture` in its place.
 */
const ScreenWallpaper = ({
  picture,
  screen,
  settled,
  step,
}: {
  picture: string | undefined;
  screen: string | undefined;
  settled: boolean;
  step: number;
}) => (
  <div className={screenStyles} style={useScreenRegion(screen)}>
    {picture === undefined ? (
      <Rotation settled={settled} step={step} />
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
 * Both themes' photographs at `step`, over each theme's photograph from the
 * repository.
 */
const Rotation = ({ settled, step }: { settled: boolean; step: number }) => (
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
          data-wallpaper={Layer.Fallback}
          src={WALLPAPER_FALLBACKS[theme]}
        />
        {WALLPAPER_PHOTOS[theme].map((photo, index, photos) =>
          isMounted(index, step, photos.length, settled) ? (
            <Photo
              key={photo}
              layer={layerOf(index, step, photos.length, settled)}
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
 * screen, fading out, or next. The next one mounts a whole step early so it
 * has loaded before it fades in. The rest stay unmounted, so the page does not
 * hold every 4K photograph at once.
 */
const isMounted = (
  index: number,
  step: number,
  length: number,
  settled: boolean,
): boolean =>
  index === (step + 1) % length ||
  layerOf(index, step, length, settled) !== Layer.Waiting;

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
  // The depth of windows hidden behind a tab (`COVERED` in `placement.ts`).
  // They come later in the document, so they draw over the wallpaper. Higher,
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
