// The shell guard-webview-history.sh drives: one browser window, sent to two
// pages, and then driven with the four controls a chrome's address bar has.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for the reason the other two <webview> guards do: the
// browser binds WebViewGuestHost only for the shell's origin, so a <webview>
// anywhere else cannot ask for a guest at all.
//
// ?drive= IS THE EXPERIMENT, and it is not the ?kind= the other two guards
// use. An <iframe> in the element's place would be no control here: it has no
// goBack() at all, so the run would end on a TypeError rather than on a
// reading. What this guard's control removes is the CALLS — the same element,
// the same guest, the same navigations, and nothing driven at it. Then the
// third page appearing is a page that moved on its own, which is the one
// confound the positive run cannot see from the inside, and the slow page
// arriving is what makes the positive run's not arriving a measurement of
// stop() rather than of a fixture nobody asked.
//
// EACH STEP WAITS FOR WHAT IT NEEDS — the element's `url` and `loading` —
// bounded by a timeout the guard passes in. A step that never happens sits out
// its bound and is read as it stands, which is the fixed schedule this was, so
// a broken engine gets the readings it always got. What is asserted is still
// the ORDER of the pages the guest showed rather than when each arrived.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to
// its own log:
//
//   GUARD driving mode=…       the module ran and which run this is. Without
//                              it, a silent log is a shell that never started
//   GUARD navigating path=…    what the HARNESS did, so the guest's own lines
//                              can be read against what it was asked for
//   GUARD calling …            a control was driven, in the positive run only
//   GUARD history-state …      what the element says back and forward can do,
//                              at one point in the schedule, and how many
//                              changes it had announced by then
//   GUARD loading-state …      whether the element says a page is still
//                              arriving, at one point in the schedule, and how
//                              many changes it had announced by then
//   GUARD done                 the schedule finished, so the readings below
//                              are complete rather than caught mid-run
//
// The pages themselves say `GUARD guest-shown path=…`, from the fixture
// server; the sequence of those lines, and the four `history-state` and three
// `loading-state` readings beside it, are the whole verdict.
//
// WHY `loading` IS READ HERE AND NOT IN A GUARD OF ITS OWN. Its claim needs a
// page that is settled and a page that is still on its way, in one run, on one
// element — and this guard already builds both: `/two` has finished
// arriving, and `/slow` is a navigation the fixture holds open for longer than
// the step that follows it. A second guard would be a second copy of that
// fixture and that schedule for one property.
//
// AND WHY THE CONTROL SAYS LESS ABOUT IT than about the four calls. `loading`
// separates inside a single run: an element answering `true` to everything
// fails the settled reading and one answering `false` to everything fails the
// pending one, so neither needs a second run to be caught. What the control
// adds is that the pending reading is the fixture's doing rather than the four
// calls'.
//
// WHEN THIS STARTS LISTENING, AND WHY NOT AT THE TOP. `canGoBack` and
// `canGoForward` are properties rather than the payload of an event, because a
// chrome renders from state and a shell that mounts late hears nothing — a
// React shell registers its listeners in its first effect flush, which is after
// the element is in the document and after the guest's first page has
// committed. The reading at `two-pages` is what says that design works: it is
// taken with NO listener on the element, so `events=0` beside it, and it is
// still the browser's answer. The listener goes on straight after it, so the
// rest of the run also says the event exists for a shell to re-render on.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
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
 * A number of milliseconds out of the query. Loud rather than NaN, which would
 * schedule every step at once and report a sequence about nothing.
 */
const requiredMilliseconds = (parameters, name) => {
  const value = Number(required(parameters, name));
  if (Number.isFinite(value)) {
    return value;
  } else {
    throw new Error(`guard-webview-history: ?${name}= is a number of ms`);
  }
};

/** Whether this run drives the controls, or is the control that drives none. */
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
// The bound on the first page, which has to be asked for, attached and
// navigated, and on the last, which the control waits out the fixture for.
const settle = requiredMilliseconds(parameters, "settle");
// The bound on each step in between.
const step = requiredMilliseconds(parameters, "step");
// How long the control watches a step it does not drive: an absence has no
// event to wait for.
const quiet = requiredMilliseconds(parameters, "quiet");
// How long `/slow` is pending before stop(), so its request is at the fixture.
const hold = requiredMilliseconds(parameters, "hold");

// Polled rather than listened for: `two-pages` must be read with no listener on
// the element at all.
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

// The four under test. In the control they are not called at all — see the
// header — and the line says so, so that a log with no `calling` in it is a
// control rather than a positive run that lost its schedule.
const call = (name, drive) => {
  if (drives) {
    say(`calling ${name}`);
    drive(view);
  } else {
    say(`not calling ${name}`);
  }
};

// Every history change the element has announced. A count rather than the
// values it carried: the event says "read them again" and carries nothing, so
// what there is to report about it is that it happened.
let announced = 0;

// And every loading change, counted separately for the same reason and kept
// apart from the history ones because they answer different questions: a run
// can move a guest's history without a load a browser would spin for, and can
// load without the history changing at all.
let loadingAnnounced = 0;

// Start hearing them. Called ONCE, and deliberately late — see the header.
const listen = () => {
  view.addEventListener("domicile-history-change", () => {
    announced += 1;
  });
  view.addEventListener("domicile-loading-change", () => {
    loadingAnnounced += 1;
  });
};

// What the element says at one point in the schedule. Read off the element
// rather than remembered from an event, which is the property this guard
// exists to assert.
const readState = (at) => {
  say(
    `history-state at=${at} can=${view.canGoBack}/${view.canGoForward}` +
      ` events=${announced}`,
  );
};

// WHERE THE ELEMENT SAYS THE PAGE IS, and what the browser says about the
// connection behind it. A LINE OF ITS OWN rather than two more fields on
// `history-state`, because the guard parses that line with a sed anchored at
// both ends — appending to it would break the readings that already work,
// which is the wrong way to add a measurement.
//
// THE PATH AS WELL AS THE ADDRESS. The address is what a person reading the
// log wants; the path is what the guard compares, for the reason the page
// sequence is compared by path — the port is the fixture's and changes per run.
const readPage = (at) => {
  say(
    `page-state at=${at} path=${pathShown()} security=${view.security}` +
      ` url=${view.url ?? ""}`,
  );
};

// An element that has reported nothing has no address to take a path out of,
// and `new URL("")` throws — which would end the run on a TypeError and turn
// "the element said nothing" into "the harness broke".
const pathShown = () => {
  const url = view.url ?? "";
  return url === "" ? "" : new URL(url).pathname;
};

// And whether it says a page is on its way, read the same way and at points
// chosen for what the guest is doing rather than for what was driven at it:
// one where a page has finished arriving, one where a navigation the fixture
// is holding open has been pending for a HOLD.
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

// Loads seen starting, polled like everything else here. The address alone
// cannot say a page arrived: the engine shows a navigation's address before
// its load starts.
let loadsSeen = 0;
let wasLoading = false;
setInterval(() => {
  if (view.loading && !wasLoading) {
    loadsSeen += 1;
  }
  wasLoading = view.loading;
}, POLL_MS / 5);

// The guest has loaded `path` since this was made, so its pageshow has been
// said. A load too quick to be seen costs the step its bound, not the reading.
const arrived = (path) => {
  const since = loadsSeen;
  return () => loadsSeen > since && pathShown() === path && !view.loading;
};

// The bound on a step one of the four drives. In the control nothing is driven,
// so the step is watched for `quiet` and then read as it stands.
const driven = drives ? step : quiet;

// The schedule, in order: each reading is taken once the step before it has
// landed, and before the next step drives anything.
//
// `/slow` and then stop() is the last pair for a reason — a canceled
// navigation leaves the guest showing whatever it showed before, so anything
// driven after it would be read against a page that never changed.
const run = async () => {
  // `src` last: it is what makes a <webview> ask for a guest, and before the
  // element is in the document there is no frame to attach one to.
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

  // BEFORE `listen()`, and that order is the measurement: this is the value an
  // element reports having never had a listener on it.
  readState("two-pages");
  readPage("two-pages");
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
  // A reload starts and finishes a load on the same address: two changes.
  const loads = loadingAnnounced;
  call("reload", (v) => v.reload());
  await until(() => loadingAnnounced >= loads + 2 && !view.loading, driven);

  // The settled half of the loading claim: the reload has finished.
  readLoading("settled");
  navigate("/slow");
  await until(() => view.loading, step);
  // Inherently timed: nothing here says when the request reaches the fixture.
  await pause(hold);

  // And the pending half: the fixture is still holding `/slow`. BEFORE the
  // stop, which is the only order in which there is a load left to report.
  readLoading("pending");
  call("stop", (v) => v.stop());
  await until(() => !view.loading, settle);

  readLoading("after-stop");
  say("done");
};

run().catch((error) => {
  say(`failed ${error}`);
});
