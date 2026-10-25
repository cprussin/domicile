import type { LinkColumn } from "../page/LinkColumns";
import { REPO, repoFile } from "../page/repo";

/** manganese's user docs, by what a reader wants to do. */
export const DOCS: readonly LinkColumn[] = [
  {
    links: [
      { href: "#install", label: "Install" },
      {
        href: "/docs/manganese/install",
        label: "Your first five minutes",
      },
      {
        href: "/docs/manganese/keys",
        label: "Keys cheat sheet",
      },
    ],
    title: "Get started",
    tone: "accent",
  },
  {
    links: [
      {
        href: "/docs/manganese/windows",
        label: "Windows and workspaces",
      },
      {
        href: "/docs/manganese/launcher",
        label: "The launcher",
      },
      {
        href: repoFile("docs/architecture/WEB-APPS.md"),
        label: "Web apps and extensions",
      },
      { href: "/docs/manganese/displays", label: "Several monitors" },
    ],
    title: "Use it",
    tone: "accent",
  },
  {
    links: [
      { href: "#configure", label: "Configure" },
      {
        href: "/docs/manganese/keys",
        label: "Keybindings",
      },
      {
        href: "/docs/manganese/top-bar",
        label: "The top bar",
      },
      {
        href: "/docs/manganese/wallpaper",
        label: "Theme and wallpaper",
      },
    ],
    title: "Make it yours",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/manganese/install", label: "Troubleshooting" },
      {
        href: "/docs/manganese/gpu-and-displays",
        label: "GPU and display issues",
      },
      { href: `${REPO}/issues`, label: "Report a bug" },
    ],
    title: "Help",
    tone: "muted",
  },
];
