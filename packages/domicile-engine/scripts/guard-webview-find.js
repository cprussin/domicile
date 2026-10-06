// Shell for guard-webview-find.sh: runs the element's find API against a page
// with a known match count.
//
// ?drive=find runs the schedule below. ?drive=none is the control: same
// element and pages, no find calls, so any count it reads did not come from
// find. (An <iframe> is no control: it has no find() at all.)
//
// Each step waits for `findMatches`/`findActiveMatch` up to a timeout from the
// guard, then logs what it sees, so a broken engine still gets every reading.
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD driving mode=…       which run this is
//   GUARD navigating path=…    the harness navigated
//   GUARD calling …            a find call (positive run only)
//   GUARD find-state …         matches/active and change events so far
//   GUARD done                 the schedule finished
//
// The pages log `GUARD guest-shown path=…`; see the fixture server. Domicile
// calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-find: ?${name}= is required`);
    } else {
      return value;
    }
  };

  /**
   * Reads a required integer query parameter. Throws rather than return NaN.
   */
  const requiredNumber = (parameters, name) => {
    const value = Number(required(parameters, name));
    if (Number.isInteger(value)) {
      return value;
    } else {
      throw new Error(`guard-webview-find: ?${name}= is a whole number`);
    }
  };

  /** Whether this run calls find, or is the control. */
  const drivesFind = (mode) => {
    switch (mode) {
      case "find": {
        return true;
      }
      case "none": {
        return false;
      }
      default: {
        throw new Error(
          `guard-webview-find: ?drive= is "find" or "none", got "${mode}"`,
        );
      }
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const base = required(parameters, "src");
  const drives = drivesFind(required(parameters, "drive"));
  // The word, and its match count across all frames.
  const word = required(parameters, "word");
  const matches = requiredNumber(parameters, "matches");
  // Timeout for the first page to attach, navigate and load its frame.
  const settle = requiredNumber(parameters, "settle");
  // Timeout for each later step.
  const step = requiredNumber(parameters, "step");
  // How long the control watches each step, since an absence has no event.
  const quiet = requiredNumber(parameters, "quiet");

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

  // Counts `domicile-find-change` events; the event carries no data.
  let announced = 0;
  view.addEventListener("domicile-find-change", () => {
    announced += 1;
  });

  // Logs the element's current find state.
  const readFind = (at) => {
    say(
      `find-state at=${at} find=${view.findMatches}/${view.findActiveMatch}` +
        ` events=${announced}`,
    );
  };

  // Predicate: the find shows `found` matches with `active` selected.
  const showing = (found, active) => () =>
    view.findMatches === found && view.findActiveMatch === active;

  // The guest's path, or "" before the element reports a URL (`new URL("")`
  // throws).
  const pathShown = () => {
    const url = view.url ?? "";
    return url === "" ? "" : new URL(url).pathname;
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

  // Predicate: the guest has loaded `path` since this call.
  const arrived = (path) => {
    const since = loadsSeen;
    return () => loadsSeen > since && pathShown() === path && !view.loading;
  };

  // Per-step timeout: `step` when driving, `quiet` in the control.
  const driven = drives ? step : quiet;

  // The schedule. Each reading is taken after its step settles and before the
  // next step starts.
  const run = async () => {
    say(`driving mode=${drives ? "find" : "none"}`);
    document.body.append(view);
    const words = arrived("/words");
    navigate("/words");
    await until(words, settle);

    // All matches counted, including the frame's, with the first selected.
    call("find", (v) => v.find(word));
    await until(showing(matches, 1), driven);
    readFind("found");

    // The same text again moves to the next match.
    call("find again", (v) => v.find(word));
    await until(showing(matches, 2), driven);
    readFind("next");

    // Backward moves to the previous match.
    call("find backward", (v) => v.find(word, true));
    await until(showing(matches, 1), driven);
    readFind("previous");

    call("stopFinding", (v) => v.stopFinding());
    await until(showing(0, 0), driven);
    readFind("stopped");

    // Start a find again so the navigation below has one to end. Waits for the
    // count only: which match is active after a kept selection is up to Blink.
    call("find after stopping", (v) => v.find(word));
    await until(() => view.findMatches === matches, driven);
    readFind("refound");

    // Navigating ends the find. Nothing is called here in either run.
    const elsewhere = arrived("/elsewhere");
    navigate("/elsewhere");
    await until(() => elsewhere() && showing(0, 0)(), step);
    readFind("navigated");

    say("done");
  };

  run().catch((error) => {
    say(`failed ${error}`);
  });
};
