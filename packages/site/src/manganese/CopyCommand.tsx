"use client";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { CopyButton } from "../code/CopyButton";

/**
 * A shell command with a button that copies it. A `message`, such as a prompt
 * for a coding agent, has no `$`.
 */
export const CopyCommand = ({
  command,
  kind = "command",
}: {
  command: string;
  kind?: "command" | "message";
}) => (
  <div className={boxStyles}>
    {kind === "command" ? (
      <span aria-hidden="true" className={promptStyles}>
        $
      </span>
    ) : undefined}
    <code className={commandStyles}>{command}</code>
    <CopyButton text={command} />
  </div>
);

const boxStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  flexWrap: "wrap",
  fontFamily: "code",
  fontSize: "sm",
  gap: 3,
  maxInlineSize: "100%",
  paddingBlock: 2.5,
  paddingInlineEnd: 2.5,
  paddingInlineStart: 4,
});

const promptStyles = css({ color: "muted" });

const commandStyles = css({
  color: "foreground",
  overflowWrap: "anywhere",
  textAlign: "start",
});
