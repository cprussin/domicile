// The app's pages, in the order the sidebar lists them.

export enum PageId {
  Appearance,
  Keyboard,
  Displays,
  Power,
  Privacy,
  Launcher,
  Startup,
  Extensions,
  Permissions,
  Code,
}

/** Each page's name and what it holds. */
export const PAGES = [
  {
    description: "Theme, accent color, contrast, motion and icons.",
    id: PageId.Appearance,
    title: "Appearance",
  },
  {
    description: "The keyboard layout, as xkb names it.",
    id: PageId.Keyboard,
    title: "Keyboard",
  },
  {
    description: "Where each monitor goes, and how large things are on it.",
    id: PageId.Displays,
    title: "Displays",
  },
  {
    description: "When the screens go dark, and how the desktop unlocks.",
    id: PageId.Power,
    title: "Power & lock",
  },
  {
    description:
      "What apps are asked not to do. An app that ignores the request is not stopped.",
    id: PageId.Privacy,
    title: "Privacy",
  },
  {
    description: "What the launcher's file search leaves out.",
    id: PageId.Launcher,
    title: "Launcher",
  },
  {
    description: "Commands run once when the desktop starts.",
    id: PageId.Startup,
    title: "Startup",
  },
  {
    description: "Chrome extensions in browser windows.",
    id: PageId.Extensions,
    title: "Extensions",
  },
  {
    description: "What each site may use: the camera, your location and more.",
    id: PageId.Permissions,
    title: "Site permissions",
  },
  {
    description: "The config file and the shell, as code.",
    id: PageId.Code,
    title: "Code",
  },
] as const;
