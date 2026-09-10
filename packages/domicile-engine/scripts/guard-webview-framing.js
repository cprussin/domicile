// The shell guard-webview-framing.sh drives: one element, showing one site.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument.
//
// It has to be a domicile:// document for a second reason too: the browser
// binds WebViewGuestHost only for the shell's origin, so a <webview> on any
// other page cannot ask for a guest at all.
//
// ?kind= is the whole experiment. `webview` must show a site that refuses to
// be framed; `iframe`, laid out identically beside nothing, must not — and
// that is the negative control, because a run where neither shows anything and
// a run where the guard cannot see anything look the same from outside.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-framing: ?${name}= is required`);
  } else {
    return value;
  }
};

/**
 * The element under test. Not `document.createElement(kind)` on whatever the
 * query said: an unknown tag would become an HTMLUnknownElement, lay out as
 * nothing, and the run would report "the colour is absent" about an element
 * that was never there.
 */
const buildView = (kind) => {
  switch (kind) {
    case "webview": {
      return document.createElement("webview");
    }
    case "iframe": {
      return document.createElement("iframe");
    }
    default: {
      throw new Error(
        `guard-webview-framing: ?kind= is "webview" or "iframe", got "${kind}"`,
      );
    }
  }
};

const parameters = new URLSearchParams(location.search);
const view = buildView(required(parameters, "kind"));

// Inset rather than filling the page, so the witness colour the body paints is
// still visible around it. The probe needs to find the witness to be able to
// say that anything was measured at all — see engine_colour_probe.cc.
//
// Whole percentages of a window whose size the harness chose, so the box lands
// on integer pixels and the flat colour inside it is not resampled onto a
// half-pixel edge. No transform, for the same reason: spike-iframe.sh measured
// a surface-backed element under `transform` differing from a <div> on its
// outline, and this assertion is an exact colour match.
view.style.position = "absolute";
view.style.left = "10%";
view.style.top = "10%";
view.style.width = "80%";
view.style.height = "70%";
view.style.border = "0";

document.body.style.background = `#${required(parameters, "witness")}`;

// Last, and this is the order that matters: `src` is what makes the element
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));
