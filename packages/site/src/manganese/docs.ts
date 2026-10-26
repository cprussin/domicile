import type { LinkColumn } from "../page/LinkColumns";
import { REPO } from "../page/repo";

/** manganese's user docs, by what a reader wants to do. */
export const DOCS: readonly LinkColumn[] = [
  {
    links: [
      { href: "/docs/manganese/install", label: "Install" },
      { href: "/docs/manganese/first-steps", label: "First steps" },
      { href: "/docs/manganese/keys", label: "Keys cheat sheet" },
    ],
    title: "Get started",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/manganese/windows", label: "Windows and workspaces" },
      { href: "/docs/manganese/browser", label: "Web apps and extensions" },
      { href: "/docs/manganese/launcher", label: "The launcher" },
      { href: "/docs/manganese/monitors", label: "Monitors and casting" },
    ],
    title: "Use it",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/manganese/settings", label: "Settings" },
      { href: "/docs/manganese/keys#add-your-own", label: "Keybindings" },
      { href: "/docs/manganese/top-bar", label: "The top bar" },
      { href: "/docs/manganese/appearance", label: "Theme and wallpaper" },
    ],
    title: "Make it yours",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/manganese/troubleshooting", label: "Troubleshooting" },
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
