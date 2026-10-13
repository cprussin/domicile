import { useWorkspaces } from "@domicile-desktop/manganese-window-management/workspaces-context";
import { css } from "../styled-system/css";

/** The current binding mode, shown only when it is not `default`. */
export const Mode = () => {
  const { mode } = useWorkspaces();
  return mode === "default" ? undefined : (
    <span className={modeStyles}>{mode}</span>
  );
};

// Uses capitals rather than a color, since the bar's text is always white.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});
