import type { LinkColumn } from "../page/LinkColumns";
import { repoFile } from "../page/repo";

/** The shell author's docs, by where a reader is. */
export const DOCS: readonly LinkColumn[] = [
  {
    links: [
      { href: "/docs/shells/quickstart", label: "Quickstart" },
      { href: "/docs/shells/from-manganese", label: "Start from manganese" },
      { href: "/docs/apps/build", label: "Build an app" },
      {
        href: "/docs/shells/writing",
        label: "Concepts: shells, windows, focus, keys",
      },
      {
        href: repoFile("docs/architecture/ONE-PAGE-FOR-THE-DESK.md"),
        label: "One page across every monitor",
      },
    ],
    title: "Start",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/shells/browser-windows", label: "Browser windows" },
      { href: "/docs/shells/extensions", label: "Extensions" },
      {
        href: "/docs/shells/desktop-events",
        label: "Displays, theme, tray, notifications",
      },
      { href: "/docs/shells/dialogs", label: "Dialogs and portals" },
      { href: "/docs/shells/idle-and-lock", label: "Idle and lock" },
      { href: "/docs/shells/system-access", label: "System access" },
      { href: "/docs/shells/packaging", label: "Packaging a shell" },
    ],
    title: "Guides",
    tone: "accent",
  },
  {
    links: [
      { href: "/docs/reference/react", label: "@domicile-desktop/react" },
      { href: "/docs/reference/sdk", label: "@domicile-desktop/sdk" },
      { href: "/docs/reference/elements", label: "Elements: <app>, <webview>" },
      { href: "/docs/reference/config", label: "The config file" },
      { href: "/docs/reference/cli", label: "The domicile command" },
      {
        href: repoFile("packages/shell-manganese/docs/SOURCE.md"),
        label: "Manganese's packages",
      },
    ],
    title: "Reference",
    tone: "muted",
  },
  {
    links: [
      {
        href: repoFile("docs/architecture/ARCHITECTURE.md"),
        label: "Architecture",
      },
      {
        href: repoFile("docs/architecture/ENGINE-FORK.md"),
        label: "The engine fork",
      },
      { href: repoFile("docs/DEVELOPING.md"), label: "Contributing" },
      { href: repoFile("ROADMAP.md"), label: "Roadmap" },
    ],
    title: "Under the hood",
    tone: "muted",
  },
];
