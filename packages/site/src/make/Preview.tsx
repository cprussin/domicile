"use client";

import type { Shell } from "@domicile-desktop/sdk/shell";

import { css } from "../../styled-system/css";
import { previewDesktop } from "./preview-desktop";
import type { StandIn } from "./stand-ins";

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
  app { background: #18161f; color: #ece9f5; display: block; overflow: hidden; position: relative; }
  .app-note { background: rgb(0 0 0 / 0.7); border-radius: 999px; color: #fff; font-size: 10px; padding: 3px 8px; position: absolute; right: 8px; top: 8px; white-space: nowrap; }
  app > div { block-size: 100%; box-sizing: border-box; font-size: 12px; overflow: hidden; }
  app p, app h1 { margin: 0; }
  .app-browser { background: #f6f7f9; color: #1f2328; display: flex; flex-direction: column; }
  .app-bar { background: #e4e6eb; padding: 6px 8px; }
  .app-url { background: #fff; border-radius: 999px; color: #57606a; display: block; font-size: 11px; padding: 3px 10px; }
  .app-page { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; }
  .app-page h1 { font-size: 18px; }
  .app-page p { color: #57606a; }
  .app-hero { aspect-ratio: 16 / 7; background: linear-gradient(120deg, #8b5cf6, #22d3ee); border-radius: 8px; max-inline-size: 420px; }
  .app-lines { display: flex; flex-direction: column; gap: 6px; }
  .app-lines i { background: #d0d7de; block-size: 6px; border-radius: 3px; inline-size: 80%; }
  .app-lines i:nth-child(2) { inline-size: 65%; }
  .app-lines i:nth-child(3) { inline-size: 72%; }
  .app-chat { display: flex; flex-direction: column; gap: 6px; justify-content: flex-end; padding: 10px; }
  .app-chat p { border-radius: 12px; max-inline-size: 75%; padding: 5px 10px; }
  .app-them { align-self: flex-start; background: #2c2a35; }
  .app-me { align-self: flex-end; background: #7c3aed; }
  .app-music { align-items: center; display: flex; gap: 12px; padding: 12px; }
  .app-cover { aspect-ratio: 1; background: linear-gradient(135deg, #f97316, #db2777); block-size: 72%; border-radius: 8px; flex: none; max-block-size: 120px; }
  .app-track { display: flex; flex: 1; flex-direction: column; gap: 3px; min-inline-size: 0; }
  .app-track span { color: #a19cb0; }
  .app-progress { background: #3a3745; block-size: 4px; border-radius: 2px; margin-block: 6px 2px; }
  .app-progress i { background: #ece9f5; block-size: 100%; border-radius: 2px; display: block; inline-size: 58%; }
  .app-files { align-content: start; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); padding: 36px 12px 12px; }
  .app-folder { align-items: center; color: #c9c5d6; display: flex; flex-direction: column; font-size: 11px; gap: 4px; }
  .app-folder::before { aspect-ratio: 4 / 3; background: #60a5fa; border-radius: 3px 8px 6px 6px; content: ""; inline-size: 40px; }
  .app-launched { align-items: center; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
  .app-launched b { font-size: 16px; }
  .app-launched span { color: #a19cb0; font: 11px ui-monospace, monospace; }
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
    const { domicile, standIns } = previewDesktop();
    new MutationObserver(() => {
      fillWindows(page, standIns());
    }).observe(page.body, { childList: true, subtree: true });
    shell(page.body, domicile);
    fillWindows(page, standIns());
  }
};

/** Draws each stand-in, marked as one, in its `<app>`s that are still empty. */
const fillWindows = (page: Document, standIns: readonly StandIn[]) => {
  for (const { appId, html } of standIns) {
    for (const app of page.querySelectorAll(`app[app-id="${appId}"]:empty`)) {
      app.innerHTML = `${html}<span class="app-note">Stand-in example. On your computer, this is a real app.</span>`;
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
