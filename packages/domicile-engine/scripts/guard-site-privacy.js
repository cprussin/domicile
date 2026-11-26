// The shell for guard-site-privacy.sh. It draws two <webview>s, `a` and `b`,
// each a window of its own, on guard-ad-blocking-server.py's page, and turns
// ad blocking off for a's window, then for the site, then back on, loading
// each page again after each change as a shield would.
//
// - `?page=` is the page's address, without its query.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                                      this module ran
//   GUARD privacy step=N view=V site=S mode=M for=F blocked=C
//
// after each page has loaded and its count settled. The pages log which of
// their scripts ran themselves, as `as=VN`: a1 is view a's page at step 1.
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

export const HostShell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const page = new URLSearchParams(location.search).get("page");
  if (page === null) {
    throw new Error("guard-site-privacy: ?page= is required");
  }

  document.body.style.margin = "0";
  document.body.style.display = "flex";
  document.body.style.blockSize = "100vh";

  const view = () => {
    const made = document.createElement("webview");
    made.style.flex = "1";
    made.style.border = "0";
    document.body.append(made);
    return made;
  };
  const views = { a: view(), b: view() };

  // Resolves once `name` has loaded its page `as`, and the count, reported at
  // most every quarter second, has had a second to settle.
  const load = (name, as) =>
    new Promise((resolve) => {
      const shown = views[name];
      const loaded = () => {
        if (!shown.loading && shown.url.includes(`as=${as}`)) {
          shown.removeEventListener("domicile-loading-change", loaded);
          setTimeout(resolve, 1000);
        }
      };
      shown.addEventListener("domicile-loading-change", loaded);
      shown.setAttribute("src", `${page}?as=${as}`);
    });

  const report = (step, name) => {
    const shown = views[name];
    say(
      `privacy step=${step} view=${name} site=${shown.privacySite} ` +
        `mode=${shown.blockAdsAndTrackers} ` +
        `for=${shown.blockAdsAndTrackersSetFor} blocked=${shown.blockedCount}`,
    );
  };

  const run = async () => {
    // 1. Both on the profile's standard.
    await load("a", "a1");
    report(1, "a");

    // 2. Off in a's window only.
    views.a.setBlockAdsAndTrackers("off", "window");
    await load("a", "a2");
    report(2, "a");

    // 3. b, another window on the same site, is not.
    await load("b", "b1");
    report(3, "b");

    // 4. Off for the site, from a: both windows, with a's own gone.
    views.a.setBlockAdsAndTrackers(null, "window");
    views.a.setBlockAdsAndTrackers("off", "site");
    await load("a", "a3");
    report(4, "a");
    await load("b", "b2");
    report(4, "b");

    // 5. Back to the profile's, from b.
    views.b.setBlockAdsAndTrackers(null, "site");
    await load("b", "b3");
    report(5, "b");
    say("privacy done");
  };

  run().catch((error) => {
    say(`privacy failed ${error}`);
  });

  say("shell-loaded");
};
