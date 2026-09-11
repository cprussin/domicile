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
// EVERY STEP IS ON A TIMER, and there is nothing better available: this
// element fires no navigation event, the browser tells the renderer nothing
// about the guest's loads, and the guest's page is cross-origin to this
// document. So the intervals are generous — the guard owns them and passes
// them in, so one file decides how long everything gets — and what is asserted
// is the ORDER of the pages the guest showed rather than when each arrived.
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
//   GUARD done                 the schedule finished, so the readings below
//                              are complete rather than caught mid-run
//
// The pages themselves say `GUARD guest-shown path=…`, from the fixture
// server; the sequence of those lines, and the four `history-state` readings
// beside it, are the whole verdict.
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
// How long the first page gets, which is also how long the last one gets to
// NOT arrive: the guest has to be asked for, attached and navigated before
// anything here means anything, and the slow page has to be given longer than
// the fixture's own wait before its absence is a measurement.
const settle = requiredMilliseconds(parameters, "settle");
// And how long each step after that gets.
const step = requiredMilliseconds(parameters, "step");

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

// Start hearing them. Called ONCE, and deliberately late — see the header.
const listen = () => {
  view.addEventListener("domicile-history-change", () => {
    announced += 1;
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

// The schedule, as what happens rather than as nested timeouts: each step is
// `after` milliseconds past the one before it, and the order is the experiment.
//
// `/slow` and then stop() is the last pair for a reason — a cancelled
// navigation leaves the guest showing whatever it showed before, so anything
// driven after it would be read against a page that never changed.
//
// EACH READING COMES BEFORE THE STEP IT IS NAMED AFTER DRIVES ANYTHING, so it
// describes where the guest has been sitting for a whole STEP rather than what
// it is in the middle of doing.
const schedule = [
  {
    act: () => {
      readState("start");
      navigate("/two");
    },
    after: settle,
  },
  {
    act: () => {
      // BEFORE `listen()`, and that order is the measurement: this is the
      // value an element reports having never had a listener on it.
      readState("two-pages");
      listen();
      call("goBack", (v) => v.goBack());
    },
    after: step,
  },
  {
    act: () => {
      readState("after-back");
      call("goForward", (v) => v.goForward());
    },
    after: step,
  },
  {
    act: () => {
      readState("after-forward");
      call("reload", (v) => v.reload());
    },
    after: step,
  },
  { act: () => navigate("/slow"), after: step },
  { act: () => call("stop", (v) => v.stop()), after: step },
  { act: () => say("done"), after: settle },
];

// Last, and this is the order that matters: `src` is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
say(`driving mode=${drives ? "history" : "none"}`);
document.body.append(view);
navigate("/one");

const total = schedule.reduce((at, { act, after }) => {
  const when = at + after;
  setTimeout(act, when);
  return when;
}, 0);
say(`scheduled ${schedule.length} steps over ${total}ms`);
