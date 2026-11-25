// The shell guard-extension-page.sh drives: three pages side by side, in the
// default, the work and the private browser profile.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD shell-loaded             this module ran
//   GUARD focused at=…             a page took focus, and the tray its profile
//   GUARD popup at=… url=…         the action's key asked for its popup
//   GUARD taking commands          it listens for `extensioncommandpressed`
//                                  now: the default page took focus again
//   GUARD pressed name=… profile=… it was given the `?expect=` extension's
//                                  command
//   GUARD badge at=… text=…        the extension's badge in that profile, which
//                                  says what its service worker heard
//   GUARD menu at=… items=…        a page's context menu, and the labels of the
//                                  items extensions add to it
//   GUARD ran a stale item         it ran an item of a page that was gone
//
// It runs no command. It runs the first item of the first menu, and of the
// second once its page has navigated.
//
// Everything is inside `HostShell`, which the document Domicile writes calls once
// the module has loaded.

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-extension-page: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const params = new URLSearchParams(location.search);
  const expected = params.get("expect");
  const src = params.get("src");
  if (expected === null || src === null) {
    throw new Error("guard-extension-page: ?expect= and ?src= are required");
  }

  host.addEventListener("extensionschanged", () => {
    const action = host.extensions?.find(({ id }) => id === expected);
    if (action !== undefined) {
      say(`badge at=${action.profile} text=${action.badgeText}`);
    }
  });

  host.addEventListener("extensionpopuprequested", ({ popup, profile }) => {
    say(`popup at=${profile} url=${popup}`);
  });

  let defaultFocuses = 0;
  const takeCommands = () => {
    host.addEventListener("extensioncommandpressed", ({ data }) => {
      const { id, name, profile } = JSON.parse(data);
      if (id === expected) {
        say(`pressed name=${name} profile=${profile}`);
      }
    });
    say("taking commands");
  };

  let menus = 0;
  const runItem = (view, event, item) => {
    menus += 1;
    if (menus === 1) {
      event.runExtensionItem(item.id);
    } else {
      // Once the new page has committed and loaded. Not on
      // `domicile-page-change`: the address changes as the navigation starts,
      // while the old page is still up, and an item run then is not stale.
      let ran = false;
      view.addEventListener("domicile-loading-change", () => {
        if (!ran && !view.loading && view.url.includes("again=1")) {
          ran = true;
          event.runExtensionItem(item.id);
          say("ran a stale item");
        }
      });
      view.setAttribute("src", `${src}?at=default&again=1`);
    }
  };

  const pages = [
    { at: "default", place: (_view) => undefined },
    {
      at: "work",
      place: (view) => {
        view.setAttribute("profile", "work");
      },
    },
    {
      at: "private",
      place: (view) => {
        view.setAttribute("private", "");
      },
    },
  ];
  document.body.style.margin = "0";
  for (const [column, { at, place }] of pages.entries()) {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.insetBlockStart = "0";
    view.style.insetInlineStart = `${(column * 100) / pages.length}%`;
    view.style.inlineSize = `${100 / pages.length}%`;
    view.style.blockSize = "100%";
    view.style.border = "0";
    place(view);
    view.addEventListener("domicile-guest-focus", () => {
      view.focus();
      host.setExtensionsProfile(at);
      say(`focused at=${at}`);
      defaultFocuses += at === "default" ? 1 : 0;
      if (at === "default" && defaultFocuses === 2) {
        takeCommands();
      }
    });
    view.addEventListener("domicile-context-menu", (event) => {
      const items = JSON.parse(event.extensionItems);
      say(`menu at=${at} items=${items.map(({ label }) => label).join(",")}.`);
      if (items.length > 0) {
        runItem(view, event, items[0]);
      }
    });
    document.body.append(view);
    // After attaching: it asks for a guest, which needs a frame.
    view.setAttribute("src", `${src}?at=${at}`);
  }
  say("shell-loaded");
};
