import { useId } from "react";

import { css } from "../../styled-system/css";
import { stack } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

type Props = ExtendProps<"section", { title?: string | undefined }>;

/**
 * A surface: a padded, bordered container that stacks its children vertically,
 * with an optional `title` rendered as its heading. The base building block for
 * the app's chrome panels — settings, sidebars, and the like frame their content
 * in one rather than each re-deriving the same card treatment. Styling is fixed
 * (it's a design primitive, not a `className` sink); compose layout inside it.
 *
 * A card is a thematic grouping, not a styling wrapper, so it renders a
 * `<section>`. When it has a `title`, the heading names the section
 * (`aria-labelledby`), promoting it to a landmark `region` a screen reader can
 * jump to; an untitled card stays a plain, unnamed section.
 */
export const Card = ({ children, title, ...props }: Props) => {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title === undefined ? undefined : headingId}
      {...props}
      className={cardStyles}
    >
      {title !== undefined && (
        <h2 className={headingStyles} id={headingId}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
};

// A vertical `stack` carries the flex column + gap; the surface tokens ride
// alongside. `stack` defaults to `direction: column` and leaves `alignItems`
// unset, so children stretch to the card's width.
const cardStyles = stack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  gap: 3,
  padding: 4,
});

const headingStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  margin: 0,
});
