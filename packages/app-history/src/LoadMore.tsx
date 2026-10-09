import { useEffect, useRef } from "react";

import { css } from "../styled-system/css";

type Props = { onVisible: () => void };

/**
 * An empty strip after the last row that asks for more once it comes within
 * a screen of the view.
 */
export const LoadMore = ({ onVisible }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          onVisible();
        }
      },
      { rootMargin: "100% 0%" },
    );
    if (ref.current !== null) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, [onVisible]);
  return <div aria-hidden className={stripStyles} ref={ref} />;
};

const stripStyles = css({ blockSize: 1 });
