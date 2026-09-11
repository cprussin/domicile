// The shell guard-control-arrival.sh drives: a page that does nothing but hear
// the control channel and price the hop into itself.
//
// A module rather than a page, because that is what a shell is here -- the
// engine writes the document and loads exactly one module into it, and it has
// to be a domicile:// document because the browser binds the control channel
// only for the shell's origin. See ShellURLLoaderFactory::ShellDocument.
//
// WHAT THIS PAGE IS FOR. Between a line on the compositor's socket and a
// listener here there is a stage nothing in a page could see: a read in the
// browser process, a mojo message, a hop into this renderer, a dispatch. The
// deleted instrument tried to price it against `Event.timeStamp`, which is when
// the event was *constructed* -- in this process, at dispatch -- so it reported
// a few microseconds of Blink and the shell printed `ipc_ms=0` every interval
// for as long as it existed. `arrival` is the browser's own stamp for the
// moment it had the bytes, put on this document's clock, so the subtraction
// below is the stage rather than a rounding error.
//
// It is also where the cursor's closed set is read end to end: the compositor
// stand-in sends a shape the engine knows, one it does not, and another it
// does, in that order.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening              `navigator.domicile` exists and a listener is
//                                registered -- the harness working rather than
//                                a finding, and what tells "nothing arrived"
//                                apart from "this module never ran"
//   GUARD clock now=…            `performance.now()` when the listener was
//                                registered, so an `arrival` can be read
//                                against the clock it claims to be on
//   GUARD app-cursor cursor=…    a cursor reached this page, and which one.
//                                THE CLAIM about the closed set: `grab` and
//                                `zoom-out` must appear and `pointr` must not
//   GUARD hop arrival=… stamp=… ms=…
//                                the stage, in milliseconds. THE CLAIM about
//                                the stamp
//   GUARD hop-shape finite=… positive=… ordered=…
//                                that `arrival` is a number on this clock at
//                                all: finite, after the time origin, and not
//                                after the dispatch it precedes. A hop of the
//                                right size computed from a `NaN` and an
//                                `undefined` is not a measurement, and the
//                                three readings are what say which

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const host = navigator.domicile;
if (host === null || host === undefined) {
  // Loud rather than a page that quietly measures nothing: without the control
  // channel there is nothing to hear and every assertion below would be absent
  // for a reason that is not the one the guard is asking about.
  throw new Error(
    "guard-control-arrival: navigator.domicile is absent, so this document" +
      " was not served by the forked engine",
  );
}

host.addEventListener("appcursor", (event) => {
  say(`app-cursor app=${event.appId} cursor=${event.cursor}`);

  // THE SUBTRACTION THIS FILE EXISTS FOR. Both are DOMHighResTimeStamps on this
  // document's time origin: `arrival` is when the browser process had the line,
  // `timeStamp` is when this event was constructed for dispatch.
  const hop = event.timeStamp - event.arrival;
  say(
    `hop arrival=${event.arrival.toFixed(3)}` +
      ` stamp=${event.timeStamp.toFixed(3)} ms=${hop.toFixed(3)}`,
  );

  // And whether those two numbers are numbers. An attribute that does not exist
  // reads `undefined`, `undefined - n` is `NaN`, and `NaN.toFixed(3)` is the
  // string "NaN" -- which prints in the line above and looks like a reading.
  // `positive` is the other half: a zero `arrival` is what a stamp that was
  // never filled in looks like, and a hop measured against it is the whole age
  // of the document.
  say(
    `hop-shape finite=${Number.isFinite(event.arrival)}` +
      ` positive=${event.arrival > 0}` +
      ` ordered=${event.arrival <= event.timeStamp}`,
  );
});

// AFTER the listener, not before: registering one is what binds the channel --
// see DomicileHost::AddedEventListener -- so the browser does not reach for the
// compositor's socket until the line above has run, and nothing can arrive
// before this page is ready for it.
say(`clock now=${performance.now().toFixed(3)}`);
say("listening");
