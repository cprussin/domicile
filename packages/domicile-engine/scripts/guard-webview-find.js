// The shell guard-webview-find.sh drives: one browser window on a page with a
// known count of one word in it, searched with the find a chrome's find bar
// has.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it. And a
// domicile:// document, because the browser binds WebViewGuestHost for the
// shell's origin and no other. See guard-webview-history.js, whose shape this
// is.
//
// ?drive= IS THE EXPERIMENT. `find` drives the schedule below; `none` runs the
// same element, the same guest and the same two pages and CALLS NOTHING. An
// <iframe> in the element's place would be no control: it has no find() at
// all, so the run would end on a TypeError rather than on a reading. Then any
// count the control reads is one nobody asked for, and the positive run's
// counts need not be the find's.
//
// EACH STEP WAITS FOR WHAT IT NEEDS — the element's `findMatches` and
// `findActiveMatch` — bounded by a timeout the guard passes in. A step that
// never happens sits out its bound and is read as it stands, so a broken
// engine still gets every reading.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to
// its own log:
//
//   GUARD driving mode=…       the module ran and which run this is
//   GUARD navigating path=…    what the HARNESS did
//   GUARD calling …            a find was driven, in the positive run only
//   GUARD find-state …         what the element says the find found, at one
//                              point in the schedule, as matches/active, and
//                              how many changes it had announced by then
//   GUARD done                 the schedule finished
//
// The pages themselves say `GUARD guest-shown path=…`, from the fixture
// server.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
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
 * A whole number out of the query. Loud rather than NaN, which would schedule
 * every step at once or wait for a count no page has.
 */
const requiredNumber = (parameters, name) => {
  const value = Number(required(parameters, name));
  if (Number.isInteger(value)) {
    return value;
  } else {
    throw new Error(`guard-webview-find: ?${name}= is a whole number`);
  }
};

/** Whether this run drives a find, or is the control that drives none. */
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
// What to find, and how many of it the page holds across its frames.
const word = required(parameters, "word");
const matches = requiredNumber(parameters, "matches");
// The bound on the first page, which has to be asked for, attached, navigated
// and have its frame load.
const settle = requiredNumber(parameters, "settle");
// The bound on each step after it.
const step = requiredNumber(parameters, "step");
// How long the control watches a step it does not drive: an absence has no
// event to wait for.
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

// The calls under test. In the control they are not made at all, and the line
// says so, so that a log with no `calling` in it is a control rather than a
// positive run that lost its schedule.
const call = (name, drive) => {
  if (drives) {
    say(`calling ${name}`);
    drive(view);
  } else {
    say(`not calling ${name}`);
  }
};

// Every find change the element has announced. A count rather than the values
// it carried: the event carries nothing, so what there is to report about it
// is that it happened.
let announced = 0;
view.addEventListener("domicile-find-change", () => {
  announced += 1;
});

// What the element says at one point in the schedule, read off the element
// rather than remembered from an event.
const readFind = (at) => {
  say(
    `find-state at=${at} find=${view.findMatches}/${view.findActiveMatch}` +
      ` events=${announced}`,
  );
};

// Whether the element says the find stands at `found` matches with `active`
// selected. A function of the pair, so each step names the reading it waits
// for rather than how to get it.
const showing = (found, active) => () =>
  view.findMatches === found && view.findActiveMatch === active;

// The path the element says the guest is on. An element that has reported
// nothing has no address, and `new URL("")` throws.
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

// Loads seen starting, polled. The address alone cannot say a page arrived:
// the engine shows a navigation's address before its load starts.
let loadsSeen = 0;
let wasLoading = false;
setInterval(() => {
  if (view.loading && !wasLoading) {
    loadsSeen += 1;
  }
  wasLoading = view.loading;
}, POLL_MS / 5);

// The guest has loaded `path` since this was made.
const arrived = (path) => {
  const since = loadsSeen;
  return () => loadsSeen > since && pathShown() === path && !view.loading;
};

// The bound on a step a find drives. In the control nothing is driven, so the
// step is watched for `quiet` and then read as it stands.
const driven = drives ? step : quiet;

// The schedule, in order: each reading is taken once the step before it has
// landed, and before the next step drives anything.
const run = async () => {
  say(`driving mode=${drives ? "find" : "none"}`);
  document.body.append(view);
  const words = arrived("/words");
  navigate("/words");
  await until(words, settle);

  // THE POSITIVE: every match counted, the frame's included, and the first
  // one selected.
  call("find", (v) => v.find(word));
  await until(showing(matches, 1), driven);
  readFind("found");

  // The same text again is the next match, not a new search.
  call("find again", (v) => v.find(word));
  await until(showing(matches, 2), driven);
  readFind("next");

  // And backward is the one before.
  call("find backward", (v) => v.find(word, true));
  await until(showing(matches, 1), driven);
  readFind("previous");

  call("stopFinding", (v) => v.stopFinding());
  await until(showing(0, 0), driven);
  readFind("stopped");

  // A find for the navigation to end. Which match a search begun from a kept
  // selection lands on is Blink's business, so this waits for the count.
  call("find after stopping", (v) => v.find(word));
  await until(() => view.findMatches === matches, driven);
  readFind("refound");

  // A NEW PAGE ENDS A FIND. Nothing is called here in either run.
  const elsewhere = arrived("/elsewhere");
  navigate("/elsewhere");
  await until(() => elsewhere() && showing(0, 0)(), step);
  readFind("navigated");

  say("done");
};

run().catch((error) => {
  say(`failed ${error}`);
});
