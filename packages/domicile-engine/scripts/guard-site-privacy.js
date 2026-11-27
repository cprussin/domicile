// The shell for guard-site-privacy.sh. It draws two <webview>s, `a` and `b`,
// each a window of its own, on guard-ad-blocking-server.py's page, and turns
// ad blocking off for a's window, then for the site, then back on, loading
// each page again after each change as a shield would. Then it does the same
// with the protections beside it, on the server's landing page at localhost,
// which a link with tracking in it leads to.
//
// - `?page=` is the page's address, without its query.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                                      this module ran
//   GUARD privacy step=N view=V site=S mode=M for=F blocked=C
//   GUARD privacy protections step=N view=V site=S links=L/F device=D/F
//   GUARD privacy later view=b mode=M for=F links=L/F
//
// after each page has loaded and its count settled, and, once done, each time
// b's report changes without a load: the guard then sets the site from the
// command socket, as the Settings app does. L and D are `on` or `off`, each
// with where it came from. The pages log which of their scripts ran, and the
// landing page what reached it and what it read of the device, themselves,
// as `as=VN`: a1 is view a's page at step 1.
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

  // The landing page at localhost, as a link with tracking in it leads to;
  // set as the shell sets an address, so it is checked as the user's.
  const landing = new URL(page);
  landing.hostname = "localhost";
  landing.pathname = "/landing";

  // Resolves once `name` has landed `as`, and the page has logged what
  // reached it and what it read, which it says by going to its own `#read`.
  const land = (name, as) =>
    new Promise((resolve) => {
      const shown = views[name];
      const read = () => {
        if (shown.url.includes(`as=${as}&`) && shown.url.endsWith("#read")) {
          shown.removeEventListener("domicile-page-change", read);
          resolve();
        }
      };
      shown.addEventListener("domicile-page-change", read);
      shown.setAttribute(
        "src",
        `${landing.href}?as=${as}&keep=1&fbclid=f&utm_source=u`,
      );
    });

  const protection = (shown, name) =>
    `${shown.privacyProtections()[name]}/` +
    `${shown.privacyProtectionsSetFor()[name]}`;

  // Resolves once `name` reports what `says` asks for. A change made on one
  // <webview> reaches the browser on that element's own pipe, and another's
  // navigation on its own, so a navigation started right after a change can
  // reach the browser first. The browser tells every page of the site once
  // it has made the change, so waiting for that orders the two.
  const until = (name, says) =>
    new Promise((resolve) => {
      const shown = views[name];
      const check = () => {
        if (says(shown)) {
          shown.removeEventListener("domicile-site-privacy-change", check);
          resolve();
        }
      };
      shown.addEventListener("domicile-site-privacy-change", check);
      check();
    });

  const shows = (name, links, device) =>
    until(
      name,
      (shown) =>
        protection(shown, "removeTrackingFromLinks") === links &&
        protection(shown, "hideDeviceDetails") === device,
    );

  const mode = (name, mode, setFor) =>
    until(
      name,
      (shown) =>
        shown.blockAdsAndTrackers === mode &&
        shown.blockAdsAndTrackersSetFor === setFor,
    );

  const reportProtections = (step, name) => {
    const shown = views[name];
    say(
      `privacy protections step=${step} view=${name} ` +
        `site=${shown.privacySite} ` +
        `links=${protection(shown, "removeTrackingFromLinks")} ` +
        `device=${protection(shown, "hideDeviceDetails")}`,
    );
  };

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
    await mode("a", "off", "window");
    await load("a", "a2");
    report(2, "a");

    // 3. b, another window on the same site, is not.
    await load("b", "b1");
    report(3, "b");

    // 4. Off for the site, from a: both windows, with a's own gone.
    views.a.setBlockAdsAndTrackers(null, "window");
    views.a.setBlockAdsAndTrackers("off", "site");
    await mode("a", "off", "site");
    await mode("b", "off", "site");
    await load("a", "a3");
    report(4, "a");
    await load("b", "b2");
    report(4, "b");

    // 5. Back to the profile's, from b.
    views.b.setBlockAdsAndTrackers(null, "site");
    await mode("b", "standard", "profile");
    await load("b", "b3");
    report(5, "b");

    // 6. Tracking kept in links in a's window only.
    views.a.setPrivacyProtection("removeTrackingFromLinks", false, "window");
    await shows("a", "off/window", "on/profile");
    await land("a", "a6");
    reportProtections(6, "a");

    // 7. b, another window, still has it removed, and its device hidden.
    await land("b", "b7");
    reportProtections(7, "b");

    // 8. Both off for the site, from a, now on it, with a's own gone.
    views.a.setPrivacyProtection("removeTrackingFromLinks", null, "window");
    views.a.setPrivacyProtection("removeTrackingFromLinks", false, "site");
    views.a.setPrivacyProtection("hideDeviceDetails", false, "site");
    await shows("b", "off/site", "off/site");
    await land("b", "b8");
    reportProtections(8, "b");

    // 9. Back to the profile's, from b.
    views.b.setPrivacyProtection("removeTrackingFromLinks", null, "site");
    views.b.setPrivacyProtection("hideDeviceDetails", null, "site");
    await shows("b", "on/profile", "on/profile");
    await land("b", "b9");
    reportProtections(9, "b");

    views.b.addEventListener("domicile-site-privacy-change", () => {
      say(
        `privacy later view=b mode=${views.b.blockAdsAndTrackers} ` +
          `for=${views.b.blockAdsAndTrackersSetFor} ` +
          `links=${protection(views.b, "removeTrackingFromLinks")}`,
      );
    });
    say("privacy done");
  };

  run().catch((error) => {
    say(`privacy failed ${error}`);
  });

  say("shell-loaded");
};
