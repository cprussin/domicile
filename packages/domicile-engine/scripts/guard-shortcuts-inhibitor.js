// The shell guard-shortcuts-inhibitor.sh drives: a desktop's window, and
// nothing in it.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument.
//
// NOTHING ON THE PAGE IS UNDER TEST, and that is why there is nothing on it.
// The request this guard reads is the BROWSER process asking the host
// compositor for an inhibitor over the surface its toplevel is, made in
// WaylandToplevelWindow::SetUpShellIntegration() where the window is set up —
// so it is made whatever the document does, and a page with work in it would
// only add ways for the run to fail before the window exists. A domicile://
// document rather than any other because that is what `domicile-launch` starts
// a nested desktop on, and the switch that drives the request is passed for
// exactly that run.
//
// WHAT THIS PAGE SAYS, to the console, which the engine writes to its own log:
//
//   GUARD shell-loaded   the document came up and ran its module. Diagnostics
//                        and not a reading: every claim this guard makes is
//                        measured on the wire between the browser and the host,
//                        which a page can neither see nor reach

console.log("GUARD shell-loaded");
