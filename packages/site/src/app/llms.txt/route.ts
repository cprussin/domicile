// domicile-desktop.com/llms.txt: what a coding agent needs to write a
// Domicile shell, then a link to every docs page (https://llmstxt.org).

import { sectionsFor } from "../../docs/pages";

export const dynamic = "force-static";

const SITE = "https://domicile-desktop.com";

const SUMMARY = `# Domicile

> Domicile is a Wayland compositor whose desktop is a web page. A shell is a module that exports \`Shell\`; Domicile calls it with the page's root element and the desktop. Each window is an \`<app app-id>\` element: put it where the window goes and style it with CSS.

A shell in React and Tailwind, \`shell.tsx\`:

\`\`\`tsx
/// <reference types="@domicile-desktop/react/elements" />
import "@tailwindcss/browser";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

const Desktop = () => {
  const focused = useFocusedWindow();
  // Menus and tooltips have a parent. This shell leaves them out.
  const windows = useWindows().filter((window) => window.parent === undefined);
  return (
    <main className="flex h-screen gap-2 p-2">
      {windows.map((window) => (
        <app
          app-id={window.appId}
          className={window.appId === focused ? "flex-1 ring-2" : "flex-1"}
          key={window.appId}
        />
      ))}
    </main>
  );
};

export const Shell = mount(Desktop);
\`\`\`

- Run it with \`domicile ./shell.tsx\`. After each change, \`domicile load-shell ./shell.tsx\` swaps it in place: windows stay open, and a build that fails keeps the running shell.
- \`domicile\` only transpiles and bundles the file. \`@domicile-desktop/*\` and React come from Domicile; any other import is installed from npm into the nearest \`package.json\`.
- Nothing needs a build step: \`import "@tailwindcss/browser";\` is Tailwind compiled in the page, as a plain npm package. For a desktop you keep, bundle it yourself (your own Vite, Tailwind config and plugins) and run \`domicile ./dist/shell.js\`.
- React ignores \`on…\` props on \`<app>\`. Put handlers on an element around it, such as a title bar.
- \`useDomicile()\` is the desktop: \`windows.focus(appId)\`, \`windows.close(appId)\` and the rest of the typed API.
- \`<NestedShell shell={Shell} />\` (\`@domicile-desktop/react/nested-shell\`) runs another shell, such as \`runManganese()\` from \`@domicile-desktop/manganese\`, inside this one. Draw windows and bind keys in only one of them.
- A shell's page has \`Content-Security-Policy: script-src 'self'\`: no \`eval\`, \`new Function\` or inline scripts.
`;

const sections = sectionsFor("domicile")
  .map(
    ({ title, pages }) =>
      `### ${title}\n\n${pages
        .map(({ slug, title: page }) => `- [${page}](${SITE}/docs/${slug})`)
        .join("\n")}`,
  )
  .join("\n\n");

const userGuide = sectionsFor("manganese")
  .flatMap(({ pages }) => pages)
  .map(({ slug, title }) => `- [${title}](${SITE}/docs/${slug})`)
  .join("\n");

const BODY = `${SUMMARY}
## Docs

${sections}

## Optional

Manganese, Domicile's own shell, for its users:

${userGuide}
`;

export const GET = (): Response =>
  new Response(BODY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
