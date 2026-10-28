import { css } from "../../styled-system/css";
import { Backticked } from "../page/Backticked";

/** What to try first, with each `backticked` span set as code. */
export const Hint = ({ text }: { text: string }) => (
  <p className={hintStyles}>
    {"Try it: "}
    <Backticked text={text} />
  </p>
);

const hintStyles = css({ color: "muted", fontSize: "sm" });
