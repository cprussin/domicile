// The popup window's page. It reports which window it is in and whether
// tabs.query finds it as a popup tab, then removes the window, as Bitwarden
// does after sign-in.
//
// The result goes into this page's address,
// `?current=<id>&type=<type>&found=<n>`, as in popup.js. `location.replace`
// keeps history to one entry: a page with history may not close itself.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { tabs, windows } = globalThis.chrome;

const asked = new URLSearchParams(location.search);

const say = (answer) => {
  location.replace(`window.html?${new URLSearchParams(answer)}`);
};

if (asked.has("current")) {
  // In the control this is the shell's own window, so removal is refused and
  // the shell must see no close. The refusal goes to the engine's log.
  windows.remove(Number(asked.get("current"))).catch((error) => {
    console.log(`window remove refused: ${error.message}`);
  });
} else {
  // A failed read writes `current=error-<message>`.
  Promise.all([windows.getCurrent(), tabs.query({ windowType: "popup" })]).then(
    ([current, found]) => {
      say({ current: current.id, found: found.length, type: current.type });
    },
    (error) => {
      say({ current: `error-${error.message}`, found: 0, type: "none" });
    },
  );
}
