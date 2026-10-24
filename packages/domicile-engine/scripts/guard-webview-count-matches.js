// The shell guard-webview-count-matches.sh runs: one browser window, whose
// element counts a selector's matches in its page once it has loaded.
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded               the module ran
//   GUARD bad-selector name=…        what countMatches("[") threw
//   GUARD counted n=… views=…        the selector's count, and the count of
//                                    `webview`, which the page has none of
//                                    and the shell has one of
//   GUARD never-counted why=…        the page never gave a count
//
// `?selector=` is the selector counted.

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const src = parameters.get("src");
  const selector = parameters.get("selector");
  if (src === null || selector === null) {
    throw new Error(
      "guard-webview-count-matches: ?src= and ?selector= are required",
    );
  } else {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.border = "0";
    document.body.append(view);
    view.setAttribute("src", src);

    const wait = (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      });

    // The element has no guest until the page is attached, and about:blank
    // answers before the page commits, so this asks once the page has loaded.
    const counted = async (tries, why) => {
      if (tries === 0) {
        say(`never-counted why=${why}`);
        return undefined;
      } else if (view.loading || view.url !== src) {
        await wait(250);
        return counted(tries - 1, `url=${view.url} loading=${view.loading}`);
      } else {
        try {
          return {
            n: await view.countMatches(selector),
            views: await view.countMatches("webview"),
          };
        } catch (error) {
          await wait(250);
          return counted(tries - 1, error.name);
        }
      }
    };

    const run = async () => {
      try {
        await view.countMatches("[");
        say("bad-selector name=none");
      } catch (error) {
        say(`bad-selector name=${error.name}`);
      }
      const count = await counted(240, "never asked");
      if (count !== undefined) {
        say(`counted n=${count.n} views=${count.views}`);
      }
    };
    run().catch((error) => {
      say(`threw ${error}`);
    });

    say("shell-loaded");
  }
};
