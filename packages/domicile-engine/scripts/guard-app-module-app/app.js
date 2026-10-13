// The app module guard-app-module.sh runs with `run_app`. Domicile calls
// `main` with the document's body and a DomicileAppHost.
//
//   GUARD app-main narrow=<bool>   main ran; narrow when the host has no
//                                  `spawn`, so it is not the shell's
//   GUARD app-answered data=…      the stand-in compositor's answer to the
//                                  call reached the app

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
};
