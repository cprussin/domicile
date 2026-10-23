import type { LinkColumn } from "../page/LinkColumns";
import { repoFile } from "../page/repo";

/** The shell author's docs, by where a reader is. */
export const DOCS: readonly LinkColumn[] = [
  {
    links: [
      { href: "#quickstart", label: "Quickstart" },
      {
        href: repoFile("docs/WRITING-A-SHELL.md"),
        label: "Concepts: shells, elements, the connection",
      },
      {
        href: repoFile("packages/chrome-sdk/docs/ELEMENTS.md"),
        label: "Keyboard and focus",
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
      {
        href: repoFile("docs/WRITING-A-SHELL.md"),
        label: "Windows and window states",
      },
      {
        href: repoFile("docs/SHELL-BROWSER-WINDOWS.md"),
        label: "Browser windows",
      },
      {
        href: repoFile("docs/architecture/KEYBINDINGS.md"),
        label: "Keybindings",
      },
      {
        href: repoFile("docs/SHELL-DESKTOP-EVENTS.md"),
        label: "Tray, notifications, dialogs",
      },
      { href: repoFile("docs/SHELL-IDLE-AND-LOCK.md"), label: "Idle and lock" },
      { href: repoFile("docs/SHELL-SYSTEM-ACCESS.md"), label: "System access" },
      { href: repoFile("docs/SHELL-PACKAGING.md"), label: "Packaging a shell" },
    ],
    title: "Guides",
    tone: "accent",
  },
  {
    links: [
      { href: repoFile("packages/chrome-sdk/README.md"), label: "SDK API" },
      {
        href: repoFile("packages/chrome-sdk/docs/ELEMENTS.md"),
        label: "Elements: <app>, <webview>",
      },
      { href: repoFile("docs/SHELL-CONFIG.md"), label: "The config file" },
      {
        href: repoFile("docs/architecture/THE-DOMICILE-BINARY.md"),
        label: "The domicile command",
      },
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
