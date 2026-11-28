// The shell for guard-browser-protections.sh and guard-ad-blocking.sh. It
// opens a browser window in each profile the guard names, at `?page=` with
// `?as=` the profile, and draws each in its own <webview window>, side by
// side.
//
// - `?page=` is the page's address, without its query.
// - `?profiles=` is the profiles, comma-separated.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded     this module ran
//
// The pages log what they found themselves; see
// guard-browser-protections-server.py and guard-ad-blocking-server.py.
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * Reads a required query parameter. A default would make a misinvoked guard
   * measure the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-browser-protections: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-browser-protections: no desktop was handed to Shell, so this " +
        "document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const page = required(parameters, "page");
  const profiles = required(parameters, "profiles").split(",");

  document.body.style.margin = "0";
  document.body.style.display = "flex";
  document.body.style.blockSize = "100vh";

  // A <webview> for window `id`, sharing the width. `window` is set before the
  // element enters the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.flex = "1";
    view.style.border = "0";
    view.setAttribute("window", id);
    document.body.append(view);
  };

  // Opens the windows once the first window list has come (it is empty) and
  // the desk's profiles name every one the guard asked for. A window asked for
  // in a profile the engine has not heard of yet opens in the default profile
  // (ContextFor), which a guard would read as that profile's protections
  // leaking.
  let listed = false;
  let opened = false;
  const open = () => {
    const known = new Set((host.browserProfiles ?? []).map(({ id }) => id));
    if (opened || !listed || !profiles.every((id) => known.has(id))) {
      return;
    }
    opened = true;
    say(`profiles-known ${[...known].join(",")}`);
    for (const profile of profiles) {
      host.openBrowserWindow(`${page}?as=${profile}`, undefined, profile);
    }
  };
  host.addEventListener("browserprofileschanged", open);
  const drawn = new Set();
  host.addEventListener("browserwindowschanged", () => {
    listed = true;
    open();
    for (const window of host.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        draw(window.id);
      }
    }
  });
  open();

  say("shell-loaded");
};
