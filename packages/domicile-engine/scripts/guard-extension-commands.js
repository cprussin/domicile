// The shell guard-extension-commands.sh drives: a page that runs one
// extension's command, its action's menu item and its action's own command.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening            the desktop was handed to Shell and a listener
//                              is registered
//   GUARD commands count=…     an `extensioncommandschanged` arrived, and how
//                              many extensions it had
//   GUARD row fill=… action=…  the `?expect=` extension's keys, the first time
//                              it arrives
//   GUARD ready                its service worker has its listeners
//   GUARD ran badge=…        its service worker heard the command
//   GUARD menu type=… label=…  the item it adds to its action's menu
//   GUARD clicked badge=…      its service worker heard the click
//   GUARD popup url=…          its action's own command asked for its popup
//   GUARD reserved fill=…         (after the popup) its keys once the shell kept
//                              Ctrl+Shift+L for itself
//   GUARD none                 (the control) its menu is empty
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
      "guard-extension-commands: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const params = new URLSearchParams(location.search);
  const expected = params.get("expect");
  const control = params.get("control") === "1";
  if (expected === null) {
    throw new Error("guard-extension-commands: ?expect= is required");
  }

  const badge = () =>
    host.extensions?.find(({ id }) => id === expected)?.badgeText ?? "";

  const failed = (error) => {
    say(`failed error=${error.name} ${error.message}`);
  };

  // The badge a step waits for, checked now and at each `extensionschanged`.
  let waiting = undefined;
  const check = () => {
    if (waiting !== undefined && badge().startsWith(waiting.prefix)) {
      const { then } = waiting;
      waiting = undefined;
      then();
    }
  };
  const when = (prefix, then) => {
    waiting = { prefix, then };
    check();
  };
  host.addEventListener("extensionschanged", check);

  let reserving = false;
  host.addEventListener("extensionpopuprequested", ({ popup }) => {
    say(`popup url=${popup}`);
    reserving = true;
    host.reserveExtensionKeys(["Ctrl+Shift+L"]);
  });

  // The service worker adds its item after it starts, so asked again until it
  // has.
  const readMenu = () => {
    host
      .extensionMenu(expected)
      .then((menu) => {
        const [item] = JSON.parse(menu);
        if (item === undefined) {
          setTimeout(readMenu, 250);
        } else {
          say(`menu type=${item.type} label=${item.label}`);
          when("m:", () => {
            say(`clicked badge=${badge()}`);
            host.runExtensionCommand(expected, "_execute_action");
          });
          host.runExtensionMenuItem(item.id);
        }
      })
      .catch(failed);
  };

  let started = false;
  host.addEventListener("extensioncommandschanged", () => {
    const listed = JSON.parse(host.extensionCommands);
    say(`commands count=${listed.length}`);
    const row = listed.find(({ id }) => id === expected);
    if (row !== undefined && (control || !started)) {
      const keys = (name) =>
        row.commands.find((command) => command.name === name)?.keys;
      say(`row fill=${keys("fill")} action=${keys("_execute_action")}`);
    }
    if (reserving && row !== undefined) {
      const { keys } = row.commands.find(({ name }) => name === "fill");
      say(`reserved fill=${keys}.`);
    }
    if (started) {
      return;
    } else if (control) {
      started = true;
      host.runExtensionCommand(expected, "fill");
      host
        .extensionMenu(expected)
        .then((menu) => {
          if (menu === "[]") {
            say("none");
          }
        })
        .catch(failed);
    } else if (row !== undefined) {
      started = true;
      when("ready", () => {
        say("ready");
        when("c:", () => {
          say(`ran badge=${badge()}`);
          readMenu();
        });
        host.runExtensionCommand(expected, "fill");
      });
    }
  });
  say("listening");
};
