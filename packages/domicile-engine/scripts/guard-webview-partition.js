// The shell module guard-webview-partition.sh loads, once per engine run.
//
// `leg=first` writes a key into `persist:guard` and another into `guard`,
// then reads them back from a <webview> in each partition, one in none, and a
// browser window opened in `persist:guard`. `leg=restart`, after the engine
// restarts on the same profile, reads both partitions again.
//
// It must be a domicile:// document: the browser binds WebViewGuestHost only
// for the shell's origin.
//
// `partitioned=0` (the control) sets no `partition` anywhere, so every page
// shares the profile's own storage.
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD window id=… partition=…       a browser window appeared in the list,
//                                       with its `partition`
//   GUARD done                          every page reported
//
// The pages report `GUARD wrote as=…` and `GUARD read as=… keys=…` to the page
// server's log; see guard-webview-partition-server.py.
//
// The engine's document calls `Shell` once the module loads.

export const Shell = (_root, desktop) => {
  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-partition: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const site = required(parameters, "site");
  const leg = required(parameters, "leg");
  const partitioned = required(parameters, "partitioned") === "1";

  /**
   * A <webview> in `partition`, or in none for the control, with an explicit
   * size: a replaced element with `auto` size takes its intrinsic 300x150.
   */
  const view = (partition) => {
    const made = document.createElement("webview");
    made.style.inlineSize = "320px";
    made.style.blockSize = "200px";
    if (partitioned && partition !== undefined) {
      // Before the view enters the document, which reads it once.
      made.setAttribute("partition", partition);
    }
    return made;
  };

  /** Resolves once `made`'s page has reported to the server. */
  const reported = (made) =>
    new Promise((resolve) => {
      const check = () => {
        if (made.url.endsWith("#reported")) {
          made.removeEventListener("domicile-page-change", check);
          resolve();
        }
      };
      made.addEventListener("domicile-page-change", check);
      check();
    });

  /** Loads `path` in a new view in `partition` and resolves once it reported. */
  const load = (partition, path) => {
    const made = view(partition);
    document.body.append(made);
    made.setAttribute("src", `${site}${path}`);
    return reported(made);
  };

  /** Draws the first browser window listed, and resolves once it reported. */
  const shownWindow = new Promise((resolve) => {
    desktop.addEventListener("browserwindowschanged", () => {
      const [window] = desktop.browserWindows ?? [];
      if (window !== undefined && !document.querySelector("webview[window]")) {
        say(`window id=${window.id} partition=${window.partition}`);
        const shown = document.createElement("webview");
        shown.style.inlineSize = "320px";
        shown.style.blockSize = "200px";
        shown.setAttribute("window", window.id);
        document.body.append(shown);
        resolve(reported(shown));
      }
    });
  });

  const first = async () => {
    await Promise.all([
      load("persist:guard", "/write?as=writer&key=persisted"),
      load("guard", "/write?as=memorywriter&key=memory"),
    ]);
    if (partitioned) {
      desktop.openBrowserWindow(`${site}/read?as=window`, "persist:guard");
    } else {
      desktop.openBrowserWindow(`${site}/read?as=window`);
    }
    await Promise.all([
      load("persist:guard", "/read?as=same"),
      load(undefined, "/read?as=default"),
      load("guard", "/read?as=memory"),
      shownWindow,
    ]);
  };

  const restart = () =>
    Promise.all([
      load("persist:guard", "/read?as=restarted"),
      load("guard", "/read?as=restartedmemory"),
    ]);

  (leg === "first" ? first() : restart())
    .then(() => {
      say("done");
    })
    .catch((error) => {
      say(`failed ${error}`);
    });

  say("shell-loaded");
};
