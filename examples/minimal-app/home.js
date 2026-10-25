// Lists the home directory. Domicile calls `main` with the window's root
// element and the app's desktop: its `files`, `processes` and `dbus`.

export const main = async (root, domicile) => {
  root.style.whiteSpace = "pre";
  root.style.font = "14px/1.5 monospace";
  // A relative path is read from the home directory.
  const entries = await domicile.files.readDir(".");
  root.textContent = entries.match({
    Err: (error) => `could not list the home directory: ${error.message}`,
    Ok: (list) => list.map((entry) => entry.name).join("\n"),
  });
};
