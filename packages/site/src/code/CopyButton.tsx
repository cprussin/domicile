"use client";

import { Button } from "@domicile-desktop/component-library/Button";
import { useEffect, useState } from "react";

const LABELS = { copied: "Copied", failed: "Copy failed", idle: "Copy" };

/** How long "Copied" or "Copy failed" shows before the button resets. */
const SHOW_MS = 2000;

const writeToClipboard = (text: string) => navigator.clipboard.writeText(text);

/** A button that copies `text` and says whether it worked. */
export const CopyButton = ({
  text,
  write = writeToClipboard,
}: {
  text: string;
  write?: typeof writeToClipboard;
}) => {
  const [state, setState] = useState<keyof typeof LABELS>("idle");
  useEffect(() => {
    if (state === "idle") {
      return;
    }
    const timer = setTimeout(() => {
      setState("idle");
    }, SHOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  return (
    // Read out when the label changes to "Copied" or "Copy failed".
    <span aria-live="polite">
      <Button
        onClick={() => {
          write(text)
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
    </span>
  );
};
