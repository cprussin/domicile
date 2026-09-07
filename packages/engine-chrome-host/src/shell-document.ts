// The document Domicile writes for a shell.
//
// A shell is one JavaScript module — a path, and nothing else. There is no
// manifest, and there is not going to be one: everything a manifest could
// carry is an export the shell can hand over once it is running, and the one
// category that could not be (something Domicile must know *before* running
// the code) is empty, because Domicile gates nothing. It is a render library;
// the shell is the compositor and already has everything Domicile has.
//
// This is the page that module loads in, and it is the same page for every
// shell on purpose: nothing here is negotiable, and there is no way to supply
// a document of your own.
//
// What is in it is only what a desktop cannot do without:
//
//   - a charset, because a page without one is decoded by guesswork
//   - a viewport, because without it the engine lays out for a phone and every
//     coordinate the compositor is told about is wrong by a scale factor
//   - a root that fills the window, with no margin. A desktop is the whole
//     screen; eight pixels of body margin is eight pixels the compositor
//     believes it has and does not, and a client's window drawn in the wrong
//     place looks like the seam rather than like a stylesheet
//
// Nothing else. No stylesheet link, and that is the interesting omission: a
// shell's CSS comes in through its module, which means nothing paints before
// the module has run. A render-blocking `<link>` is what forces a shell that
// remembers a theme to set it from a blocking script in `<head>` — the CSS
// applies, the browser paints, and only then does a deferred module get a say.
// With no link there is nothing to paint yet, so the module's first line is
// early enough and the flash cannot happen.
//
// The title is not guessed. The directory a module came out of is as likely to
// be `dist` as anything a person would recognise, and the module's own name is
// no better — so it says Domicile until the shell says otherwise, which it
// does with `document.title` like any other page.

/** Write the document for a shell's module. */
export const shellDocument = (module: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <title>Domicile</title>
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
  </head>
  <body>
    <script src="${attribute(module)}" type="module"></script>
  </body>
</html>
`;

/**
 * A value going into a double-quoted attribute.
 *
 * The module's name came off somebody's disk and lands in the most privileged
 * page in this system, so a file called `"></script><script>…` would otherwise
 * run whatever it liked in the desktop's own document.
 *
 * `&` first, or escaping the others would escape the ampersands this puts in.
 */
const attribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
