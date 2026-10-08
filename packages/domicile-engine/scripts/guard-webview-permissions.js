// The shell guard-webview-permissions.sh drives: one browser window whose page
// asks for the camera. A module, because only a domicile:// document may ask
// for a guest.
//
// Logs:
// - permission-request: the request the element hands the shell. Answers it
//   with ?answer= ("allow" or "deny"), then logs answered.
// - site-permissions: the camera's setting each time the site's settings are
//   reported.
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = () => {
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-permissions: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const answer = required(parameters, "answer");

  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.inset = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = "100%";
  view.style.border = "0";

  view.addEventListener("domicile-permission-request", (event) => {
    event.preventDefault();
    say(
      `permission-request origin=${event.origin} permissions=${event.permissions.join(",")}`,
    );
    switch (answer) {
      case "allow":
        event.allow();
        break;
      case "deny":
        event.deny();
        break;
      default:
        throw new Error(`guard-webview-permissions: unknown answer ${answer}`);
    }
    say("answered");
  });

  view.addEventListener("domicile-site-permissions-change", () => {
    say(`site-permissions camera=${view.sitePermissions().camera}`);
  });

  document.body.style.margin = "0";
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
