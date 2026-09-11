import { flex } from "../../styled-system/patterns";
import { Clock } from "../Clock";

/**
 * What a screen the chrome is not on shows: a clock, in the middle of it.
 *
 * It is what a second monitor is worth having regardless, and it is the visible
 * proof that a display the config describes is laid out where it said — an
 * empty region and a region that is not there look identical.
 */
export const IdleScreen = () => (
  <div className={screenStyles}>
    <Clock />
  </div>
);

const screenStyles = flex({
  align: "center",
  blockSize: "100%",
  justify: "center",
});
