// The app module guard-app-module.sh runs with `run_app`. Domicile calls
// `main` with the document's body and a DomicileAppHost.
//
//   GUARD app-main narrow=<bool>   main ran; narrow when the host has no
//                                  `spawn`, so it is not the shell's
//   GUARD app-answered data=…      the stand-in compositor's answer to the
//                                  call reached the app
//   GUARD app-fetch own=… shell=…  whether fetch() read the app's own
//                                  file and the shell's: read, empty or
//                                  refused

export const main = (root, host) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };
  root.textContent = "app module";
  host.addEventListener("system", (event) => {
    say(`app-answered data=${event.data}`);
  });
  say(`app-main narrow=${host.spawn === undefined}`);
  host.callSystem(1, JSON.stringify({ call: "stat", path: "/" }));
  Promise.all([
    reading("app.js", "export const main"),
    reading("domicile://shell/guard-app-module.js", "export const Shell"),
  ])
    .then(([own, shell]) => {
      say(`app-fetch own=${own} shell=${shell}`);
    })
    .catch((error) => {
      console.error("guard-app-module: the app could not report", error);
    });
};

/** Whether fetch() answered `url` with `marker`, without it, or failed. */
const reading = (url, marker) =>
  fetch(url)
    .then((response) => response.text())
    .then(
      (text) => (text.includes(marker) ? "read" : "empty"),
      () => "refused",
    );
