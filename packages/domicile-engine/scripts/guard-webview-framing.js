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
// This is the claim and only the claim. The control that goes with it is not
// here and cannot be: an <iframe> on a domicile:// document does not load an
// http page at all, so a control written on this page would be measuring that
// rather than a framing header — which is exactly what the one that used to
// live here did. It frames the same site from an ordinary http page instead;
// see the guard's header, and guard-webview-framing-server.py.

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

const parameters = new URLSearchParams(location.search);
const view = document.createElement("webview");

// Inset rather than filling the page, so the witness colour the body paints is
// still visible around it. The probe needs to find the witness to be able to
// say that anything was measured at all — see engine_colour_probe.cc.
//
// Whole percentages of a window whose size the harness chose, so the box lands
// on integer pixels and the flat colour inside it is not resampled onto a
// half-pixel edge. The control's framing page insets its <iframe> by the same
// numbers, so the two runs put the framed page in the same place. No
// transform, for the same reason: spike-iframe.sh measured a surface-backed
// element under `transform` differing from a <div> on its outline, and this
// assertion is an exact colour match.
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
