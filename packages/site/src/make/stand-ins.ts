// The windows on the "Make your own desktop" preview's desktop. Each draws a
// small picture of a real app, styled by the preview page's `.app-*` classes.

/** A window the preview shows in place of a real app. */
export type StandIn = { appId: string; title: string; html: string };

export const STAND_INS: readonly [StandIn, ...StandIn[]] = [
  {
    appId: "browser",
    html: `<div class="app-browser">
  <div class="app-bar"><span class="app-url">github.com/cprussin/domicile</span></div>
  <div class="app-page">
    <h1>domicile</h1>
    <p>A Wayland compositor whose desktop is a web page.</p>
    <div class="app-hero"></div>
    <div class="app-lines"><i></i><i></i><i></i></div>
  </div>
</div>`,
    title: "Browser",
  },
  {
    appId: "chat",
    html: `<div class="app-chat">
  <p class="app-them">Are you joining voice?</p>
  <p class="app-me">Two minutes, finishing my bar</p>
  <p class="app-them">Send a screenshot!</p>
</div>`,
    title: "Chat",
  },
  {
    appId: "music",
    html: `<div class="app-music">
  <div class="app-cover"></div>
  <div class="app-track">
    <b>Northern Lights</b>
    <span>Aurora Trio</span>
    <div class="app-progress"><i></i></div>
    <span class="app-controls">⏮ ⏸ ⏭</span>
  </div>
</div>`,
    title: "Music",
  },
  {
    appId: "files",
    html: `<div class="app-files">
  <span class="app-folder">Documents</span>
  <span class="app-folder">Downloads</span>
  <span class="app-folder">Pictures</span>
  <span class="app-folder">Music</span>
</div>`,
    title: "Files",
  },
];

/** A stand-in for an app the shell launched, named by its command. */
export const launchedStandIn = (
  appId: string,
  argv: readonly [string, ...string[]],
): StandIn => ({
  appId,
  html: `<div class="app-launched"><b>${asText(argv[0])}</b><span>${asText(argv.join(" "))}</span></div>`,
  title: argv[0],
});

const asText = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
