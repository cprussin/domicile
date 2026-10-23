"use client";

import { Button } from "@domicile-desktop/component-library/Button";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

const LABELS = { copied: "Copied", failed: "Copy failed", idle: "Copy" };

/** A shell command with a button that copies it. */
export const CopyCommand = ({ command }: { command: string }) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className={boxStyles}>
      <span aria-hidden="true" className={promptStyles}>
        $
      </span>
      <code className={commandStyles}>{command}</code>
      <Button
        onClick={() => {
          navigator.clipboard
            .writeText(command)
            .then(() => {
              setState("copied");
            })
            .catch(() => {
              setState("failed");
            });
        }}
        size="sm"
        variant="outline"
      >
        {LABELS[state]}
      </Button>
    </div>
  );
};

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
