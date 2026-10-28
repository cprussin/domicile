import { css } from "../../styled-system/css";

/** `text`, with each `backticked` span set as code. */
export const Backticked = ({ text }: { text: string }) =>
  text.split("`").map((part, at) =>
    // Odd parts sat between backticks. Positions are stable keys.
    at % 2 === 1 ? (
      <code className={codeStyles} key={at}>
        {part}
      </code>
    ) : (
      part
    ),
  );

const codeStyles = css({ color: "foreground", fontFamily: "code" });
