// Shell module for guard-shortcuts-inhibitor.sh: an empty window.
//
// It is a module because the engine writes the shell's document and loads one
// module into it. See ShellURLLoaderFactory::ShellDocument.
//
// The page is empty because nothing on it is under test. The browser process
// requests the inhibitor in WaylandToplevelWindow::SetUpShellIntegration(),
// whatever the document does. It is a domicile:// document because
// `domicile-launch` starts a nested desktop on one.
//
// Console lines (the engine writes them to its log):
//
//   GUARD shell-loaded   the module ran. Diagnostic only; the guard measures
//                        the browser-host wire, which the page cannot see
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = () => {
  console.log("GUARD shell-loaded");
};
