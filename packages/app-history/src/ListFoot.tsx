import { Button } from "@domicile-desktop/component-library/Button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";

import { css } from "../styled-system/css";
import { center } from "../styled-system/patterns";
import { LoadMore } from "./LoadMore";

type Props = {
  complete: boolean;
  /** Whether the last page failed, which stops loading until asked again. */
  failed: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Tries the failed load again. */
  onRetry: () => void;
};

/**
 * The end of the list: a spinner while a page loads, a button to try again
 * after a page or reload fails, a closing mark once all have, and otherwise the strip that
 * loads more as it scrolls into view.
 */
export const ListFoot = ({
  complete,
  failed,
  loading,
  onLoadMore,
  onRetry,
}: Props) => {
  if (loading) {
    return (
      <div aria-label="Loading more" className={footStyles} role="status">
        <span className={spinnerStyles} />
      </div>
    );
  } else if (failed) {
    return (
      <div className={footStyles}>
        <Button
          beforeIcon={<ArrowClockwiseIcon />}
          onClick={onRetry}
          rounded
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    );
  } else if (complete) {
    return (
      <div className={footStyles}>
        <span className={endStyles}>That's everything</span>
      </div>
    );
  } else {
    return <LoadMore onVisible={onLoadMore} />;
  }
};

const footStyles = center({
  paddingBlock: 8,
});

const spinnerStyles = css({
  animation: "spin {durations.spin} {easings.linear} infinite",
  blockSize: 5,
  border: "{spacing.0.5} solid {colors.border}",
  borderBlockStartColor: "accent",
  borderRadius: "full",
  inlineSize: 5,
});

const endStyles = css({
  _after: {
    backgroundImage: "linear-gradient(to left, transparent, {colors.border})",
    blockSize: "1px",
    content: '""',
    flexGrow: 1,
  },
  _before: {
    backgroundImage: "linear-gradient(to right, transparent, {colors.border})",
    blockSize: "1px",
    content: '""',
    flexGrow: 1,
  },
  alignItems: "center",
  color: "muted",
  display: "flex",
  fontSize: "xs",
  gap: 4,
  inlineSize: "100%",
  letterSpacing: "wide",
  textTransform: "uppercase",
});
