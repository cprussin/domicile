// The docs pages: which repository markdown files the site renders, under
// which routes, in which sidebar sections.

import { join } from "node:path";

import type { ProductName } from "../page/Accent";

/** A docs page: its route under `/docs/`, its sidebar title and its file. */
export type DocPage = { slug: string; title: string; source: string };

/** A sidebar section, colored for the product it documents. */
export type DocSection = {
  title: string;
  product: ProductName;
  pages: readonly DocPage[];
};

/** The repository, which `source` paths start from, at build time. */
export const REPO_ROOT = join(process.cwd(), "..", "..");

const WM = "packages/manganese-window-management/docs";

export const SECTIONS: readonly DocSection[] = [
  {
    pages: [
      {
        slug: "manganese/install",
        source: "docs/RUNNING-A-DESKTOP.md",
        title: "Install and run",
      },
      { slug: "manganese/keys", source: `${WM}/KEYS.md`, title: "Keys" },
    ],
    product: "manganese",
    title: "Get started",
  },
  {
    pages: [
      {
        slug: "manganese/windows",
        source: `${WM}/WINDOW-MANAGEMENT.md`,
        title: "Windows and workspaces",
      },
      {
        slug: "manganese/launcher",
        source: "packages/manganese-launcher/docs/LAUNCHER.md",
        title: "The launcher",
      },
      {
        slug: "manganese/top-bar",
        source: "packages/shell-manganese/docs/TOP-BAR.md",
        title: "The top bar",
      },
      { slug: "manganese/lock", source: "docs/LOCK.md", title: "Locking" },
      {
        slug: "manganese/idle",
        source: "docs/IDLE.md",
        title: "Idle and blanking",
      },
      {
        slug: "manganese/displays",
        source: "docs/DISPLAYS.md",
        title: "Monitors",
      },
      {
        slug: "manganese/casting",
        source: "docs/CASTING-TO-TVS.md",
        title: "Casting to TVs",
      },
      {
        slug: "manganese/settings",
        source: "docs/SETTINGS.md",
        title: "Settings",
      },
      {
        slug: "manganese/history",
        source: "docs/HISTORY.md",
        title: "History",
      },
    ],
    product: "manganese",
    title: "Use it",
  },
  {
    pages: [
      {
        slug: "manganese/config",
        source: "docs/SHELL-CONFIG.md",
        title: "The config file",
      },
      {
        slug: "manganese/launcher-sources",
        source: "docs/LAUNCHER.md",
        title: "Launcher sources",
      },
      {
        slug: "manganese/wallpaper",
        source: "packages/manganese-wallpaper/docs/WALLPAPER.md",
        title: "Theme and wallpaper",
      },
    ],
    product: "manganese",
    title: "Make it yours",
  },
  {
    pages: [
      {
        slug: "manganese/gpu-and-displays",
        source: "docs/TTY-DEBUGGING.md",
        title: "GPU and display issues",
      },
    ],
    product: "manganese",
    title: "Help",
  },
];

export const PAGES: readonly DocPage[] = SECTIONS.flatMap(
  (section) => section.pages,
);

/** The page at `/docs/<segments>`, if there is one. */
export const pageAt = (segments: readonly string[]): DocPage | undefined =>
  PAGES.find((page) => page.slug === segments.join("/"));
