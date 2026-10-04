import { Card } from "@domicile-desktop/component-library/Card";
import { useDisplays } from "@domicile-desktop/component-library/DisplayProvider";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";

/**
 * A message for when the host reports a desktop with no screens.
 *
 * Without it, "not described yet" (`undefined`) and "no screens" (`[]`) both
 * show a blank window. Rendered beside the chrome, not instead of it, and not
 * fatal: a host that gains a screen describes the desktop again.
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

// Covers the whole page, since there is no screen to put it on.
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
