import { useId } from "react";

import { css } from "../../styled-system/css";
import { stack } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

type Props = ExtendProps<"section", { title?: string | undefined }>;

/**
 * A padded, bordered panel that stacks its children, with an optional `title`
 * heading.
 *
 * Renders a `<section>`. A `title` labels it, which makes it a `region`
 * landmark for screen readers.
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

// `stack` leaves `alignItems` unset, so children stretch to the card's width.
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
