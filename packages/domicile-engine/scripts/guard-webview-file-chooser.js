// Shell for guard-webview-upload.sh, guard-webview-download.sh and
// guard-webview-save-picker.sh: one browser window that answers its
// `domicile-file-chooser` events without drawing a picker.
//
//   ?answer=choose&pick=<path>   choose <path>, absolute or relative to home
//     &list=<directory>          list <directory> under `home` first
//   ?answer=cancel               cancel (the control)
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded           the module ran
//   GUARD chrome-mousedown       a press reached the shell's document
//   GUARD file-chooser mode=…    the element asked, and for what
//     suggested=…
//   GUARD listed <names>         what `list` returned, sorted
//   GUARD answered               the answer did not throw
//
// The guest page logs what it received; see
// guard-webview-file-chooser-server.py. Domicile calls `Shell` once the module
// loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
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

  // A shell strip above the element, so a click can hit the shell's document.
  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // Call `preventDefault()` in both runs so the control differs only in the
  // answer, not by falling back to the element's default cancel.
  document.addEventListener("domicile-file-chooser", (event) => {
    say(
      `file-chooser mode=${event.mode} suggested=${event.suggestedName} accept=${event.accept.join(",")}`,
    );
    event.preventDefault();
    const listing = parameters.get("list");
    if (listing === null) {
      answerIt(event);
    } else {
      event.list(`${event.home}/${listing}`).then(
        (entries) => {
          say(`listed ${entries.toSorted().join(",")}`);
          answerIt(event);
        },
        (error) => {
          say(`list-refused ${error.name}`);
        },
      );
    }
  });

  /** Answers `event` as `?answer=` says and logs it. */
  const answerIt = (event) => {
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
  };

  // Shows the harness can deliver a click to this document.
  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Explicit size: a replaced element between insets keeps its 300x150
  // intrinsic size.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";
  document.body.append(view);
  // Set `src` after attaching: it requests the guest, which needs a frame.
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
