import type { LinkColumn } from "../page/LinkColumns";
import { REPO, repoFile } from "../page/repo";

/** manganese's user docs, by what a reader wants to do. */
export const DOCS: readonly LinkColumn[] = [
  {
    links: [
      { href: "#install", label: "Install" },
      {
        href: repoFile("docs/RUNNING-A-DESKTOP.md"),
        label: "Your first five minutes",
      },
      {
        href: repoFile("packages/manganese-window-management/docs/KEYS.md"),
        label: "Keys cheat sheet",
      },
    ],
    title: "Get started",
    tone: "accent",
  },
  {
    links: [
      {
        href: repoFile(
          "packages/manganese-window-management/docs/WINDOW-MANAGEMENT.md",
        ),
        label: "Windows and workspaces",
      },
      {
        href: repoFile("packages/manganese-launcher/docs/LAUNCHER.md"),
        label: "The launcher",
      },
      {
        href: repoFile("docs/architecture/WEB-APPS.md"),
        label: "Web apps and extensions",
      },
      { href: repoFile("docs/DISPLAYS.md"), label: "Several monitors" },
    ],
    title: "Use it",
    tone: "accent",
  },
  {
    links: [
      { href: "#configure", label: "Configure" },
      {
        href: repoFile("packages/manganese-window-management/docs/KEYS.md"),
        label: "Keybindings",
      },
      {
        href: repoFile("packages/shell-manganese/docs/TOP-BAR.md"),
        label: "The top bar",
      },
      {
        href: repoFile("packages/manganese-wallpaper/docs/WALLPAPER.md"),
        label: "Theme and wallpaper",
      },
    ],
    title: "Make it yours",
    tone: "accent",
  },
  {
    links: [
      { href: repoFile("docs/RUNNING-A-DESKTOP.md"), label: "Troubleshooting" },
      {
        href: repoFile("docs/TTY-DEBUGGING.md"),
        label: "GPU and display issues",
      },
      { href: `${REPO}/issues`, label: "Report a bug" },
    ],
    title: "Help",
    tone: "muted",
  },
];
