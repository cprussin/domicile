import { Card } from "@domicile/component-library/Card";
import { useDisplays } from "@domicile/component-library/DisplayProvider";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";

/**
 * What the page says when the host describes a desktop with no screens.
 *
 * `undefined` and `[]` are different things, and this is what makes the
 * difference visible: not having been told yet is a moment, and a host that
 * says it has no screens is a host the chrome has nowhere to draw on. Without
 * this the two look identical from the outside — a blank window.
 *
 * Rendered outside the screens, and unconditionally: it is a sibling of the
 * chrome rather than an alternative to it. Not fatal either — a description is
 * not a promise about the next one, and a host that gains a screen describes
 * the desktop again.
 */
export const NoScreens = () => {
  const displays = useDisplays();
  return displays?.length === 0 ? (
    <div className={sheetStyles}>
      <Card title="No screens">
        <p className={hintStyles}>
          The host described a desktop with no displays on it, so there is
          nowhere to lay the chrome out. Domicile will draw it as soon as a
          screen is described.
        </p>
      </Card>
    </div>
  ) : undefined;
};

// The whole page, since there is no screen to put this on either.
const sheetStyles = flex({
  align: "center",
  inset: 0,
  justify: "center",
  position: "absolute",
});

const hintStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
});
