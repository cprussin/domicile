// Shell for guard-webview-history.sh: one browser window navigated to two
// pages, then driven with goBack, goForward, reload and stop.
//
// A module, because the engine writes the shell document and loads one module
// (see ShellURLLoaderFactory::ShellDocument). Loaded on a domicile:// page, the
// only origin WebViewGuestHost is bound for.
//
// ?drive=history makes the calls. ?drive=none is the control: same element and
// navigations, no calls. It shows that pages do not move on their own and that
// `/slow` does arrive when stop() is not called. (An <iframe> is no control: it
// has no goBack().)
//
// Each step waits for the element's `url` and `loading`, up to a timeout from
// the guard, then logs what it sees. The guard asserts the order of pages
// shown, not their timing.
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD driving mode=…       the module ran, and which run this is
//   GUARD navigating path=…    the harness navigated
//   GUARD calling …            a call under test (positive run only)
//   GUARD history-state …      canGoBack/canGoForward and change events so far
//   GUARD page-state …         path, security and URL
//   GUARD favicon-state …      the favicon's path
//   GUARD loading-state …      `loading` and change events so far
//   GUARD done                 the schedule finished
//
// The pages log `GUARD guest-shown path=…`; see the fixture server.
//
// `loading` is checked here because this run already has a settled page and a
// pending one (`/slow`). It needs no control: an element stuck on either value
// fails one of the two readings.
//
// Listeners are added late on purpose. `canGoBack`/`canGoForward` are
// properties so a shell that mounts late (a React shell adds listeners after
// the first page commits) can still read them. The `two-pages` reading is
// taken with no listener attached to prove that.
//
// Domicile calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-history: ?${name}= is required`);
    } else {
      return value;
    }
  };

  /**
   * Reads a required millisecond query parameter. Throws rather than return NaN.
   */
  const requiredMilliseconds = (parameters, name) => {
    const value = Number(required(parameters, name));
    if (Number.isFinite(value)) {
      return value;
    } else {
      throw new Error(`guard-webview-history: ?${name}= is a number of ms`);
    }
  };

  /** Whether this run makes the calls, or is the control. */
  const drivesControls = (mode) => {
    switch (mode) {
      case "history": {
        return true;
      }
      case "none": {
        return false;
      }
      default: {
        throw new Error(
          `guard-webview-history: ?drive= is "history" or "none", got "${mode}"`,
        );
      }
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const base = required(parameters, "src");
  const drives = drivesControls(required(parameters, "drive"));
  // Timeout for the first page to attach and navigate, and for the last step,
  // where the control waits out the fixture.
  const settle = requiredMilliseconds(parameters, "settle");
  // Timeout for each step in between.
  const step = requiredMilliseconds(parameters, "step");
  // How long the control watches each step, since an absence has no event.
  const quiet = requiredMilliseconds(parameters, "quiet");
  // How long `/slow` is pending before stop(), so its request reaches the
  // fixture.
  const hold = requiredMilliseconds(parameters, "hold");

  // Polled, not listened for: `two-pages` must be read with no listener.
  const POLL_MS = 50;

  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.inset = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = "100%";
  view.style.border = "0";

  const navigate = (path) => {
    say(`navigating path=${path}`);
    view.setAttribute("src", `${base}${path}`);
  };

  // Makes a call under test, or in the control logs that it did not, so a
  // control is distinguishable from a positive run that stalled.
  const call = (name, drive) => {
    if (drives) {
      say(`calling ${name}`);
      drive(view);
    } else {
      say(`not calling ${name}`);
    }
  };

  // Counts `domicile-history-change` events; the event carries no data.
  let announced = 0;

  // Counts `domicile-loading-change` events separately: history and loading
  // change independently.
  let loadingAnnounced = 0;

  // Called once, late on purpose; see the header.
  const listen = () => {
    view.addEventListener("domicile-history-change", () => {
      announced += 1;
    });
    view.addEventListener("domicile-loading-change", () => {
      loadingAnnounced += 1;
    });
  };

  // Logs the element's history state, read from its properties.
  const readState = (at) => {
    say(
      `history-state at=${at} can=${view.canGoBack}/${view.canGoForward}` +
        ` events=${announced}`,
    );
  };

  // Logs the element's URL and security state. A separate line because the
  // guard parses `history-state` with an anchored sed. The guard compares the
  // path, since the port changes per run.
  const readPage = (at) => {
    say(
      `page-state at=${at} path=${pathShown()} security=${view.security}` +
        ` url=${view.url ?? ""}`,
    );
  };

  // Logs the favicon's path. Read at `two-pages` only, where both runs are on
  // /two.
  const readFavicon = (at) => {
    const icon = view.favicon ?? "";
    say(
      `favicon-state at=${at} path=${icon === "" ? "" : new URL(icon).pathname}`,
    );
  };

  // The guest's path, or "" before the element reports a URL (`new URL("")`
  // throws).
  const pathShown = () => {
    const url = view.url ?? "";
    return url === "" ? "" : new URL(url).pathname;
  };

  // Logs `loading`. Read once settled and once while `/slow` is pending.
  const readLoading = (at) => {
    say(
      `loading-state at=${at} loading=${view.loading}` +
        ` events=${loadingAnnounced}`,
    );
  };

  // Resolves once `ready()` holds, or once `within` ms have passed regardless.
  const until = (ready, within) =>
    new Promise((resolve) => {
      const deadline = Date.now() + within;
      const poll = () => {
        if (ready() || Date.now() >= deadline) {
          resolve();
        } else {
          setTimeout(poll, POLL_MS);
        }
      };
      poll();
    });

  const pause = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  // Counts load starts. The URL alone is not enough: the engine shows a
  // navigation's URL before its load starts.
  let loadsSeen = 0;
  let wasLoading = false;
  setInterval(() => {
    if (view.loading && !wasLoading) {
      loadsSeen += 1;
    }
    wasLoading = view.loading;
  }, POLL_MS / 5);

  // Predicate: the guest has loaded `path` since this call. A load too quick to
  // see only costs the step its timeout.
  const arrived = (path) => {
    const since = loadsSeen;
    return () => loadsSeen > since && pathShown() === path && !view.loading;
  };

  // Per-step timeout: `step` when driving, `quiet` in the control.
  const driven = drives ? step : quiet;

  // The schedule. Each reading is taken after its step settles and before the
  // next step starts.
  //
  // `/slow` and stop() come last: a canceled navigation leaves the previous
  // page, so later steps would read an unchanged page.
  const run = async () => {
    // Attach before navigating: `src` requests the guest, which needs a frame.
    say(`driving mode=${drives ? "history" : "none"}`);
    document.body.append(view);
    const one = arrived("/one");
    navigate("/one");
    await until(one, settle);

    readState("start");
    readPage("start");
    const two = arrived("/two");
    navigate("/two");
    await until(two, step);

    // Read before `listen()`, to check the state without any listener.
    readState("two-pages");
    readPage("two-pages");
    // The favicon is reported once the head is parsed, which may be after the
    // page shows.
    await until(() => (view.favicon ?? "").endsWith("/two.png"), step);
    readFavicon("two-pages");
    listen();
    const back = arrived("/one");
    call("goBack", (v) => v.goBack());
    await until(back, driven);

    readState("after-back");
    readPage("after-back");
    const forward = arrived("/two");
    call("goForward", (v) => v.goForward());
    await until(forward, driven);

    readState("after-forward");
    readPage("after-forward");
    // A reload starts and finishes a load: two changes.
    const loads = loadingAnnounced;
    call("reload", (v) => v.reload());
    await until(() => loadingAnnounced >= loads + 2 && !view.loading, driven);

    // The reload has finished, so `loading` should be false.
    readLoading("settled");
    navigate("/slow");
    await until(() => view.loading, step);
    // Timed: nothing signals when the request reaches the fixture.
    await pause(hold);

    // The fixture is still holding `/slow`, so `loading` should be true.
    readLoading("pending");
    call("stop", (v) => v.stop());
    await until(() => !view.loading, settle);

    readLoading("after-stop");
    say("done");
  };

  run().catch((error) => {
    say(`failed ${error}`);
  });
};
