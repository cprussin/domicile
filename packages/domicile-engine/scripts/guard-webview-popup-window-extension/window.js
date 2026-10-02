// The popup window's page: which window it is in, whether tabs.query finds it
// as a popup window's tab, and then the window removed -- which is how
// Bitwarden closes its sign-in once it is signed in.
//
// THE ANSWER IS WRITTEN INTO THIS PAGE'S OWN ADDRESS,
// `?current=<id>&type=<type>&found=<n>`, for popup.js's reason. Replaced, so
// the page's history stays one entry long: a page that has been navigated in
// may not close itself, and the shell would hear nothing either way.
//
// Off `globalThis`, for popup.js's reason.
const { tabs, windows } = globalThis.chrome;

const asked = new URLSearchParams(location.search);

const say = (answer) => {
  location.replace(`window.html?${new URLSearchParams(answer)}`);
};

if (asked.has("current")) {
  // Refused for the desk's own window, which is the control's: there the
  // shell must hear no close, and the refusal is said where the engine's log
  // keeps it.
  windows.remove(Number(asked.get("current"))).catch((error) => {
    console.log(`window remove refused: ${error.message}`);
  });
} else {
  // A read that failed says so the same way: `current=error-<message>`.
  Promise.all([windows.getCurrent(), tabs.query({ windowType: "popup" })]).then(
    ([current, found]) => {
      say({ current: current.id, found: found.length, type: current.type });
    },
    (error) => {
      say({ current: `error-${error.message}`, found: 0, type: "none" });
    },
  );
}
