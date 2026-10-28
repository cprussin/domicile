// The windows on the "Make your own desktop" preview's desktop.

/** A window the preview shows in place of a real app. */
export type StandIn = { appId: string; title: string; body: string };

export const STAND_INS: readonly [StandIn, ...StandIn[]] = [
  {
    appId: "terminal",
    body: "~ $ domicile ./my-desktop.tsx\nBuilt my-desktop.tsx\nRunning.",
    title: "Terminal",
  },
  {
    appId: "editor",
    body: "export const Shell = mount(Desktop);",
    title: "Editor",
  },
  {
    appId: "music",
    body: "Now playing\n▶  Track 4 · 2:13 / 3:48",
    title: "Music",
  },
  {
    appId: "files",
    body: "Documents/\nDownloads/\n  my-desktop.tsx\nPictures/",
    title: "Files",
  },
];
