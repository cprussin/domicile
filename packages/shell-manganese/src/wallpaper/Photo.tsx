import { useEffect, useState } from "react";

import { Layer, layerStyles } from "./layer";

/** Wait before the first retry of a photograph that failed to load. */
const FIRST_RETRY_MS = 1000;

/**
 * Longest wait between retries. The network can be down, or up with no route
 * to the internet, for any length of time, so retries never stop.
 */
const MAX_RETRY_MS = 60_000;

/**
 * A photograph in the rotation in role `layer`. It stays transparent until it
 * loads, and retries with a doubling wait while it fails.
 */
export const Photo = ({ layer, src }: { layer: Layer; src: string }) => {
  // Failed attempts so far. Keys the `<img>`, so each retry is a new element
  // and a new request.
  const [failures, setFailures] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!failed) {
      return;
    }
    const timer = setTimeout(() => {
      setFailures((previous) => previous + 1);
      setFailed(false);
    }, retryDelay(failures));
    return () => {
      clearTimeout(timer);
    };
  }, [failed, failures]);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: load and error are the image's network events, not user interactions
    <img
      alt=""
      className={layerStyles}
      data-wallpaper={loaded ? layer : Layer.Waiting}
      key={failures}
      onError={() => {
        setFailed(true);
      }}
      onLoad={() => {
        setLoaded(true);
      }}
      src={src}
    />
  );
};

/** The wait before retrying after `failures` earlier failed retries. */
const retryDelay = (failures: number): number =>
  Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
