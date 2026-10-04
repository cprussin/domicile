// The shell guard-held-moments.sh drives. It binds the channel, listens for
// `focusrequested` only three seconds later -- after the compositor stand-in
// asked for focus on `first` -- and reports what it heard once the stand-in
// has asked again, for `second`:
//
//   GUARD listening                   the channel is bound
//   GUARD heard <ids> sync=<n>        the app ids it heard, in order, and how
//                                     many arrived inside its own
//                                     `addEventListener` call: none should

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-held-moments: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  // Reading binds the channel, which is what has the compositor speak.
  void host.windows;
  console.log("GUARD listening");

  setTimeout(() => {
    const heard = [];
    let adding = true;
    let sync = 0;
    host.addEventListener("focusrequested", (event) => {
      heard.push(event.appId);
      if (adding) {
        sync += 1;
      }
    });
    adding = false;
    setTimeout(() => {
      console.log(`GUARD heard ${heard.join(",")} sync=${sync}`);
    }, 4000);
  }, 3000);
};
