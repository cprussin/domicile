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

const USE = "docs/use";

const page = (slug: string, file: string, title: string): DocPage => ({
  slug: `manganese/${slug}`,
  source: `${USE}/${file}.md`,
  title,
});

export const SECTIONS: readonly DocSection[] = [
  {
    pages: [
      page("install", "INSTALL", "Install"),
      page("first-steps", "FIRST-STEPS", "First steps"),
      page("keys", "KEYS", "Keys"),
    ],
    product: "manganese",
    title: "Get started",
  },
  {
    pages: [
      page("windows", "WINDOWS", "Windows and workspaces"),
      page("browser", "BROWSER", "Browsing and web apps"),
      page("launcher", "LAUNCHER", "The launcher"),
      page("top-bar", "TOP-BAR", "The top bar"),
      page("notifications", "NOTIFICATIONS", "Notifications"),
      page("clipboard", "CLIPBOARD", "Clipboard"),
      page("screenshots", "SCREENSHOTS", "Screenshots and recordings"),
      page("lock", "LOCK-AND-IDLE", "Locking and sleep"),
      page("monitors", "MONITORS", "Monitors and casting"),
    ],
    product: "manganese",
    title: "Use it",
  },
  {
    pages: [
      page("settings", "CONFIGURE", "Settings and the config file"),
      page("appearance", "APPEARANCE", "Appearance"),
    ],
    product: "manganese",
    title: "Make it yours",
  },
  {
    pages: [
      page("troubleshooting", "TROUBLESHOOTING", "Troubleshooting"),
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
