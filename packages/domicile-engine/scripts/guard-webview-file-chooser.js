// The shell guard-webview-upload.sh and guard-webview-download.sh drive: one
// browser window, and an answer to whatever file its page asks for.
//
// A module rather than a page for the reason every guard's shell is one: the
// engine writes the document and loads exactly one module into it, and the
// browser binds WebViewGuestHost only for the shell's origin. See
// guard-webview-new-window.js.
//
// WHAT THIS PAGE IS FOR. A page's `<input type="file">` and a download's
// "where to?" are both a file picker, and a picker is the shell's to draw -- so
// the browser asks the element, the element dispatches `domicile-file-chooser`,
// and a shell answers it on the event. This page is the smallest shell that
// answers: it takes the question and answers it with `?answer=`, without
// drawing anything, because what is measured is the answer's trip and not a
// picker.
//
//   ?answer=choose&pick=<path>   take it and choose <path>, relative to the
//                                home -- THE CLAIM's run
//   ?answer=cancel               take it and cancel -- the control
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD shell-loaded           this module ran and the window is set up
//   GUARD chrome-mousedown       a press reached the SHELL's document, which is
//                                the harness working rather than a finding
//   GUARD file-chooser mode=…    THE QUESTION: the element asked, and for what
//     suggested=…
//   GUARD answered               the answer was given without a throw
//
// The page in the window says what it got for itself; see
// guard-webview-file-chooser-server.py.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-file-chooser: ?${name}= is required`);
  } else {
    return value;
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);
const answer = required(parameters, "answer");

// The shell's own half of the window, above the element. See
// guard-webview-new-window.js for why a guard has one.
const stripHeight = `${required(parameters, "strip")}px`;
const strip = document.createElement("div");
strip.style.position = "absolute";
strip.style.insetBlockStart = "0";
strip.style.insetInline = "0";
strip.style.inlineSize = "100%";
strip.style.blockSize = stripHeight;
strip.style.background = "#204060";

// THE QUESTION, and the answer. Taken with `preventDefault()` in both runs, so
// that the control differs from the claim in the answer and in nothing else:
// a control that left the event alone would be measuring the element's own
// cancel for an untaken event, which is a different claim.
document.addEventListener("domicile-file-chooser", (event) => {
  say(
    `file-chooser mode=${event.mode} suggested=${event.suggestedName} accept=${event.accept.join(",")}`,
  );
  event.preventDefault();
  switch (answer) {
    case "choose": {
      event.choose([required(parameters, "pick")]);
      break;
    }
    case "cancel": {
      event.cancel();
      break;
    }
    default: {
      throw new Error(
        `guard-webview-file-chooser: ?answer=${answer} is not one`,
      );
    }
  }
  say("answered");
});

// The harness's own reading: a press that landed in this document, which is
// what makes every absence below a measurement.
document.addEventListener("mousedown", (event) => {
  say(`chrome-mousedown target=${event.target.localName}`);
});

document.body.style.margin = "0";
document.body.append(strip);

// Sized rather than stretched between insets -- see guard-webview-new-window.js
// for the 300x150 that taught every guard here to.
const view = document.createElement("webview");
view.style.position = "absolute";
view.style.insetBlockStart = stripHeight;
view.style.insetInline = "0";
view.style.inlineSize = "100%";
view.style.blockSize = `calc(100% - ${stripHeight})`;
view.style.border = "0";
document.body.append(view);
// Last: `src` is what makes a <webview> ask for a guest, and there has to be a
// frame in the document to attach one to.
view.setAttribute("src", required(parameters, "src"));

say("shell-loaded");
