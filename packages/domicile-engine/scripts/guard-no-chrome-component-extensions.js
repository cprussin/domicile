// The shell for guard-no-chrome-component-extensions.sh. It draws nothing and
// opens no page.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded    this module ran
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

export const HostShell = () => {
  console.log("GUARD shell-loaded");
};
