"use client";

import type { Shell } from "@domicile-desktop/sdk/shell";

import { css } from "../../styled-system/css";
import { previewDesktop } from "./preview-desktop";
import { STAND_INS } from "./stand-ins";

type Props = {
  /** The shell to run. A new run gets a fresh frame. */
  shell: Shell | undefined;
  run: number;
};

/**
 * A shell running on a stand-in desktop, in a frame of its own: Tailwind's
 * stylesheet applies only there, and each run starts from a clean page.
 */
export const Preview = ({ shell, run }: Props) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the frame's page loading, not a person's input.
  <iframe
    className={frameStyles}
    key={run}
    onLoad={(event) => {
      if (shell !== undefined) {
        start(event.currentTarget, shell);
      }
    }}
    srcDoc={PAGE}
    title="Preview of your desktop"
  />
);

/** The frame's page: Tailwind, a wallpaper, and how a window looks. */
const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="/make/tailwind.js"></script>
<style>
@layer base {
  html, body { block-size: 100%; margin: 0; }
  body {
    background: linear-gradient(135deg, #3b0f7a, #0b5f73);
    color: #ece9f5;
    font: 13px/1.4 system-ui, sans-serif;
    overflow: hidden;
  }
  app { background: #18161f; color: #ece9f5; display: block; overflow: hidden; }
  app pre { font: 11px/1.5 ui-monospace, monospace; margin: 0; padding: 8px 10px; opacity: .85; }
}
</style>
</head>
<body></body>
</html>`;

/** Runs `shell` in `frame`'s page, filling each window with its stand-in. */
const start = (frame: HTMLIFrameElement, shell: Shell) => {
  const page = frame.contentDocument;
  if (page === null) {
    throw new Error("the preview's frame has no page");
  } else {
    new MutationObserver(() => {
      fillWindows(page);
    }).observe(page.body, { childList: true, subtree: true });
    shell(page.body, previewDesktop().domicile);
    fillWindows(page);
  }
};

/** Puts each stand-in's text in its `<app>`s that are still empty. */
const fillWindows = (page: Document) => {
  for (const { appId, body } of STAND_INS) {
    for (const app of page.querySelectorAll(`app[app-id="${appId}"]:empty`)) {
      const text = page.createElement("pre");
      text.textContent = body;
      app.append(text);
    }
  }
};

const frameStyles = css({
  aspectRatio: "16 / 10",
  border: "none",
  borderRadius: "xl",
  display: "block",
  inlineSize: "100%",
});
