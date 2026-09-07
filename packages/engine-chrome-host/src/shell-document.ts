// The document Domicile writes for a shell.
//
// A shell ships JavaScript and CSS. This is the page they load in, and it is
// the same page for every shell on purpose — see `shell-manifest.ts` for why
// there is no way to supply one instead.
//
// What is in here is only what a desktop cannot do without:
//
//   - a charset, because a page without one is decoded by guesswork
//   - a viewport, because without it the engine lays out for a phone and every
//     coordinate the compositor is told about is wrong by a scale factor
//   - a root that fills the window, with no margin. A desktop is the whole
//     screen; eight pixels of body margin is eight pixels the compositor
//     believes it has and does not, and a client's window drawn in the wrong
//     place looks like the seam rather than like a stylesheet
//
// Nothing else. No fonts, no reset beyond the above, no opinion about colour:
// a shell that wants a background says so in its own stylesheet, and one that
// does not gets whatever the engine's default is.

import type { ShellManifest } from "./shell-manifest";

/**
 * Write the document for a shell.
 *
 * Every value that reaches the output is escaped, because every one of them
 * came out of a file this process did not write. A manifest naming a module
 * `"></script><script>…` is a manifest that would otherwise run whatever it
 * liked in the desktop's own page, which is the most privileged place there
 * is here.
 */
export const shellDocument = (manifest: ShellManifest): string => {
  const styles = manifest.styles
    .map((href) => `    <link href="${attribute(href)}" rel="stylesheet" />\n`)
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <title>${text(manifest.name)}</title>
    <style>
      html,
      body {
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        overflow: hidden;
        padding: 0;
      }
    </style>
${styles}  </head>
  <body>
    <script src="${attribute(manifest.module)}" type="module"></script>
  </body>
</html>
`;
};

/**
 * A value going into a double-quoted attribute.
 *
 * `&` first, or escaping the others would escape the ampersands this puts in.
 */
const attribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** A value going into element content. */
const text = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
