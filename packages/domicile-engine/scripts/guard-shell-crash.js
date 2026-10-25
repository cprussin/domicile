// The shell for guard-shell-crash.sh. It does nothing but say it ran, so each
// load of the shell is one line:
//
//   GUARD shell-loaded     this module ran
//
// Everything is inside `HostShell`, which Domicile's document calls once the module
// loads.

export const HostShell = (_root, desktop) => {
  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-shell-crash: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  console.log("GUARD shell-loaded");
};
